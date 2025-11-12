// Package apigateway provides HTTP API handlers for serving chart data
// from Cloud Storage to the web frontend.
package apigateway

import (
	"context"
	"encoding/json"
	goerrors "errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/errors"
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
		log.Printf("Using local fixtures from: %s", basePath)
	case "cloud-storage":
		storageClient, err = storage.NewCloudStorageClient(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to create cloud storage client: %w", err)
		}
		log.Println("Using Cloud Storage")
	default:
		return nil, fmt.Errorf("invalid DATA_SOURCE: %s (expected: local-fixtures or cloud-storage)", dataSource)
	}

	// Initialize auth middleware
	authMiddleware, err := middleware.NewAuthMiddleware(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize auth middleware: %w", err)
	}

	// Load sport configuration
	configPath := getEnvOrDefault("SPORT_CONFIG_PATH", "config/sport_types.json")
	sportConfig, err := config.LoadSportConfig(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load sport config: %w", err)
	}
	log.Printf("Loaded sport config with %d sports", len(sportConfig.ListSports()))

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

// NewHandlerWithStorage is a constructor for testing that allows injecting a mock storage client.
func NewHandlerWithStorage(storageClient storage.Client, sportConfig *config.SportConfig) *Handler {
	// Create a mock auth middleware for testing
	mockAuth := &mockAuthMiddleware{}

	// Initialize CORS handler
	corsHandler := cors.NewHandler()

	// Initialize chi router
	r := chi.NewRouter()

	h := &Handler{
		storage:        storageClient,
		authMiddleware: mockAuth,
		corsHandler:    corsHandler,
		router:         r,
		sportConfig:    sportConfig,
	}

	// Register routes
	h.registerRoutes()

	return h
}

// mockAuthMiddleware is a no-op auth middleware for testing
type mockAuthMiddleware struct{}

func (m *mockAuthMiddleware) Middleware(next http.Handler) http.Handler {
	// Pass through without authentication (like local development mode)
	return next
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
	year := chi.URLParam(r, "year")
	if !isValidYear(year) {
		err := errors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		errors.WriteError(w, r, err, h.corsHandler)
		return
	}
	h.handleMetadata(w, r, year)
}

func (h *Handler) handleMetricsWithParam(w http.ResponseWriter, r *http.Request) {
	year := chi.URLParam(r, "year")
	if !isValidYear(year) {
		err := errors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		errors.WriteError(w, r, err, h.corsHandler)
		return
	}
	h.handleMetrics(w, r, year)
}

func (h *Handler) handleSourceWithParam(w http.ResponseWriter, r *http.Request) {
	year := chi.URLParam(r, "year")
	if !isValidYear(year) {
		err := errors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		errors.WriteError(w, r, err, h.corsHandler)
		return
	}
	h.handleSource(w, r, year)
}

func (h *Handler) handleSummaryWithParam(w http.ResponseWriter, r *http.Request) {
	year := chi.URLParam(r, "year")
	if !isValidYear(year) {
		err := errors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		errors.WriteError(w, r, err, h.corsHandler)
		return
	}
	blobPath := fmt.Sprintf("activities/%s/summary_activities.json", year)
	h.fetchAndRespond(w, r, blobPath, year, "summary")
}

func (h *Handler) handleDistancesWithParam(w http.ResponseWriter, r *http.Request) {
	year := chi.URLParam(r, "year")
	if !isValidYear(year) {
		err := errors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		errors.WriteError(w, r, err, h.corsHandler)
		return
	}
	blobPath := fmt.Sprintf("activities/%s/distances.json", year)
	h.fetchAndRespond(w, r, blobPath, year, "distances")
}

// isValidYear validates that the year string is a 4-digit number between 2000-2100
func isValidYear(s string) bool {
	if len(s) != 4 {
		return false
	}
	year, err := strconv.Atoi(s)
	return err == nil && year >= 2000 && year <= 2100
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
	configPath := getEnvOrDefault("SPORT_CONFIG_PATH", "config/sport_types.json")

	// Read and serve the raw JSON file
	// #nosec G304 - configPath is from environment variable, not user input
	data, err := os.ReadFile(configPath)
	if err != nil {
		log.Printf("Error reading sport config: %v", err)
		apiErr := errors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to load sport config",
			fmt.Sprintf("Error reading %s: %v", configPath, err),
		)
		errors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Parse to validate it's valid JSON
	var configData map[string]any
	if unmarshalErr := json.Unmarshal(data, &configData); unmarshalErr != nil {
		log.Printf("Error parsing sport config: %v", unmarshalErr)
		apiErr := errors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Invalid sport config",
			fmt.Sprintf("JSON parse error: %v", unmarshalErr),
		)
		errors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	h.respondJSON(w, r, http.StatusOK, configData)
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

	h.respondJSONRaw(w, r, http.StatusOK, data)
}

// respondJSON writes a JSON response with CORS headers.
func (h *Handler) respondJSON(w http.ResponseWriter, r *http.Request, status int, data any) {
	h.corsHandler.SetHeaders(w, r)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON response: %v", err)
	}
}

// respondJSONRaw writes pre-marshaled JSON data with CORS headers.
func (h *Handler) respondJSONRaw(w http.ResponseWriter, r *http.Request, status int, data any) {
	h.corsHandler.SetHeaders(w, r)

	w.Header().Set("Content-Type", "application/json")
	// Don't cache authenticated data - user-specific content
	w.Header().Set("Cache-Control", "private, no-store, must-revalidate")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON response: %v", err)
	}
}
