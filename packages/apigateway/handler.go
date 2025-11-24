// Package apigateway provides HTTP API handlers for serving chart data
// from Cloud Storage to the web frontend.
package apigateway

import (
	"context"
	"encoding/json"
	goerrors "errors"
	"fmt"
	"net/http"
	"os"
	"strconv"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/errors"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/storage"
	"github.com/andy-esch/desirelines/packages/apigateway/types"
	"github.com/go-chi/chi/v5"
)

// AuthMiddleware defines the interface for authentication middleware.
type AuthMiddleware interface {
	Middleware(next http.Handler) http.Handler
}

// Handler orchestrates API Gateway request processing.
type Handler struct {
	storage        storage.Client
	authMiddleware AuthMiddleware
	corsHandler    errors.CORSHandler
	router         chi.Router
	sportConfig    *config.SportConfig
}

// NewHandler creates a new API Gateway handler.
func NewHandler(ctx context.Context) (*Handler, error) {
	var storageClient storage.Client
	var err error

	// Check DATA_SOURCE environment variable
	dataSource := getEnvOrDefault("DATA_SOURCE", "cloud-storage")

	switch dataSource {
	case "local-fixtures":
		basePath := getEnvOrDefault("LOCAL_FIXTURES_PATH", "data/fixtures")
		storageClient, err = storage.NewLocalStorageClient(basePath)
		if err != nil {
			return nil, fmt.Errorf("failed to create local storage client: %w", err)
		}
		logger.Logger.Info("Using local fixtures", "base_path", basePath, "data_source", "local-fixtures")
	case "cloud-storage":
		storageClient, err = storage.NewCloudStorageClient(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to create cloud storage client: %w", err)
		}
		logger.Logger.Info("Using Cloud Storage", "data_source", "cloud-storage")
	default:
		return nil, fmt.Errorf("invalid DATA_SOURCE: %s (expected: local-fixtures or cloud-storage)", dataSource)
	}

	// Initialize auth middleware
	authMiddleware, err := middleware.NewAuthMiddleware(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize auth middleware: %w", err)
	}

	// Load sport configuration (embedded in binary via go:embed)
	sportConfig, err := config.LoadSportConfig("")
	if err != nil {
		return nil, fmt.Errorf("failed to load sport config: %w", err)
	}
	logger.Logger.Info("Loaded sport config", "sport_count", len(sportConfig.ListSports()))

	// Initialize CORS handler
	corsHandler := cors.NewHandler()

	// Initialize chi router
	r := chi.NewRouter()

	h := &Handler{
		storage:        storageClient,
		authMiddleware: authMiddleware,
		corsHandler:    corsHandler,
		router:         r,
		sportConfig:    sportConfig,
	}

	// Register routes
	h.registerRoutes()

	return h, nil
}

// getEnvOrDefault returns environment variable value or default if not set.
func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// registerRoutes configures all application routes.
func (h *Handler) registerRoutes() {
	// CORS middleware for all routes
	h.router.Use(h.corsMiddleware)

	// Public endpoints (no auth required)
	h.router.Get("/health", h.handleHealth)
	h.router.Get("/sports/config", h.handleSportConfig)

	// Authenticated route group
	h.router.Group(func(r chi.Router) {
		r.Use(h.authMiddleware.Middleware)

		// Multi-sport endpoints
		r.Get("/activities/{year}/metadata", h.handleMetadataWithParam)
		r.Get("/activities/{year}/metrics", h.handleMetricsWithParam)
		r.Get("/activities/{year}/source", h.handleSourceWithParam)

		// Legacy endpoints (backward compatibility)
		r.Get("/activities/{year}/summary", h.handleSummaryWithParam)
		r.Get("/activities/{year}/distances", h.handleDistancesWithParam)
	})
}

// corsMiddleware wraps the CORS handler as chi middleware
func (h *Handler) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Handle CORS preflight
		if r.Method == http.MethodOptions {
			h.corsHandler.HandlePreflight(w, r)
			return
		}

		// Set CORS headers for all requests
		h.corsHandler.SetHeaders(w, r)

		// Continue to next handler
		next.ServeHTTP(w, r)
	})
}

// ServeHTTP implements http.Handler interface.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Delegate to chi router (CORS handled by middleware)
	h.router.ServeHTTP(w, r)
}

// handleHealth returns API health status.
func (h *Handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	response := types.HealthResponse{
		Status: "healthy",
	}
	h.respondJSON(w, r, http.StatusOK, response)
}

// Wrapper handlers that extract path parameters and validate year

func (h *Handler) handleMetadataWithParam(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}
	h.handleMetadata(w, r, year)
}

func (h *Handler) handleMetricsWithParam(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}
	h.handleMetrics(w, r, year)
}

func (h *Handler) handleSourceWithParam(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}
	h.handleSource(w, r, year)
}

func (h *Handler) handleSummaryWithParam(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}
	blobPath := fmt.Sprintf("activities/%s/summary_activities.json", year)
	h.fetchAndRespond(w, r, blobPath, year, "summary")
}

func (h *Handler) handleDistancesWithParam(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}
	blobPath := fmt.Sprintf("activities/%s/distances.json", year)
	h.fetchAndRespond(w, r, blobPath, year, "distances")
}

const (
	// MinValidYear is the earliest year for which activity data can be requested.
	// Set to 2000 to allow pre-Strava historical data imports.
	MinValidYear = 2000

	// MaxValidYear is the latest year for which activity data can be requested.
	// Set to 2050 as a reasonable planning horizon (approximately one generation).
	MaxValidYear = 2050
)

// isValidYear validates that the year string is a 4-digit number within valid bounds.
func isValidYear(s string) bool {
	if len(s) != 4 {
		return false
	}
	year, err := strconv.Atoi(s)
	return err == nil && year >= MinValidYear && year <= MaxValidYear
}

// validateAndGetYear extracts and validates the year path parameter.
// Returns the year string and true if valid, or writes an error response and returns false.
func (h *Handler) validateAndGetYear(w http.ResponseWriter, r *http.Request) (string, bool) {
	year := chi.URLParam(r, "year")
	if !isValidYear(year) {
		err := errors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		errors.WriteError(w, r, err, h.corsHandler)
		return "", false
	}
	return year, true
}

// validateAndGetSport extracts and validates the sport query parameter.
// Returns the sport name and true if valid, or writes an error response and returns false.
func (h *Handler) validateAndGetSport(w http.ResponseWriter, r *http.Request) (string, bool) {
	sport := r.URL.Query().Get("sport")
	if sport == "" {
		err := errors.NewAPIError(http.StatusBadRequest, "Missing 'sport' query parameter")
		errors.WriteError(w, r, err, h.corsHandler)
		return "", false
	}

	if !h.sportConfig.ValidateSport(sport) {
		err := errors.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid sport: %s", sport))
		errors.WriteError(w, r, err, h.corsHandler)
		return "", false
	}

	return sport, true
}

// handleMetrics serves sport-specific metrics data.
func (h *Handler) handleMetrics(w http.ResponseWriter, r *http.Request, year string) {
	sport, ok := h.validateAndGetSport(w, r)
	if !ok {
		return
	}

	blobPath := fmt.Sprintf("activities/%s/metrics/%s.json", year, sport)
	h.fetchAndRespond(w, r, blobPath, year, sport)
}

// handleSource serves sport-specific source data.
func (h *Handler) handleSource(w http.ResponseWriter, r *http.Request, year string) {
	sport, ok := h.validateAndGetSport(w, r)
	if !ok {
		return
	}

	blobPath := fmt.Sprintf("activities/%s/source/%s.json", year, sport)
	h.fetchAndRespond(w, r, blobPath, year, sport)
}

// handleMetadata serves year metadata (all sports).
func (h *Handler) handleMetadata(w http.ResponseWriter, r *http.Request, year string) {
	blobPath := fmt.Sprintf("activities/%s/metadata.json", year)
	h.fetchAndRespond(w, r, blobPath, year, "metadata")
}

// handleSportConfig serves the sport configuration JSON.
func (h *Handler) handleSportConfig(w http.ResponseWriter, r *http.Request) {
	// Get embedded sport config JSON
	data := config.GetRawConfigJSON()
	if len(data) == 0 {
		logger.Logger.Error("Embedded sport config is empty")
		apiErr := errors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to load sport config",
			"Embedded sport config is not available",
		)
		errors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Validate it's valid JSON without unmarshaling
	if !json.Valid(data) {
		logger.Logger.Error("Embedded sport config is invalid JSON")
		apiErr := errors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Invalid sport config",
			"JSON validation failed",
		)
		errors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Write raw JSON directly (no marshal/unmarshal cycle)
	h.respondRawJSON(w, r, http.StatusOK, data)
}

// fetchAndRespond is a helper to fetch blob and respond (DRY).
func (h *Handler) fetchAndRespond(w http.ResponseWriter, r *http.Request, blobPath, year, dataType string) {
	data, err := h.storage.ReadJSON(r.Context(), blobPath)
	if err != nil {
		if goerrors.Is(err, storage.ErrNotFound) {
			apiErr := errors.NewAPIError(http.StatusNotFound, fmt.Sprintf("No data for %s/%s", year, dataType))
			errors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
		apiErr := errors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Internal server error",
			fmt.Sprintf("Error reading blob %s: %v", blobPath, err),
		)
		errors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	h.respondJSON(w, r, http.StatusOK, data)
}

// respondJSON writes a JSON response with CORS headers.
func (h *Handler) respondJSON(w http.ResponseWriter, r *http.Request, status int, data any) {
	h.corsHandler.SetHeaders(w, r)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		logger.Logger.Error("Error encoding JSON response", "error", err)
	}
}

// respondRawJSON writes raw JSON bytes with CORS headers.
// Use this for pre-marshaled JSON data to avoid double encoding.
func (h *Handler) respondRawJSON(w http.ResponseWriter, r *http.Request, status int, data []byte) {
	h.corsHandler.SetHeaders(w, r)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if _, err := w.Write(data); err != nil {
		logger.Logger.Error("Error writing raw JSON response", "error", err)
	}
}
