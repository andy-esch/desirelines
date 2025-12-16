// Package apigateway provides HTTP API handlers for serving activity data
// from PostgreSQL to the web frontend.
package apigateway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/adapters/postgres"
	"github.com/andy-esch/desirelines/packages/apigateway/apierrors"
	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types"
	"github.com/go-chi/chi/v5"
)

// AuthMiddleware defines the interface for authentication middleware.
type AuthMiddleware interface {
	Middleware(next http.Handler) http.Handler
}

// Handler orchestrates API Gateway request processing.
type Handler struct {
	activityRepo   repository.ActivityRepository
	authMiddleware AuthMiddleware
	corsHandler    apierrors.CORSHandler
	router         chi.Router
	sportConfig    *config.SportConfig
}

// NewHandler creates a new API Gateway handler.
func NewHandler(ctx context.Context) (*Handler, error) {
	var err error

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

	// Initialize PostgreSQL repository (required for production)
	var activityRepo repository.ActivityRepository
	pool, err := postgres.NewPool(ctx)
	if err != nil {
		// Graceful degradation: warn but don't fail startup
		// This allows the service to start even if database is temporarily unavailable
		logger.Logger.Warn("Database initialization failed, continuing without database",
			"error", err)
	} else {
		activityRepo = postgres.NewActivityRepository(pool)
		logger.Logger.Info("Database repository initialized")
	}

	h := &Handler{
		activityRepo:   activityRepo,
		authMiddleware: authMiddleware,
		corsHandler:    corsHandler,
		router:         r,
		sportConfig:    sportConfig,
	}

	// Register routes
	h.registerRoutes()

	return h, nil
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

		// Multi-sport endpoints (PostgreSQL backed)
		r.Get("/activities/{year}/metadata", h.handleMetadataWithParam)
		r.Get("/activities/{year}/metrics", h.handleMetricsWithParam)
		r.Get("/activities/{year}/source", h.handleSourceWithParam)

		// Legacy endpoint (backward compatibility, PostgreSQL backed)
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

	// Check database connectivity if enabled
	if h.activityRepo != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := h.activityRepo.Ping(ctx); err != nil {
			logger.Logger.Warn("Database health check failed", "error", err)
			response.Database = "unhealthy"
		} else {
			response.Database = "healthy"
		}
	}

	h.respondJSON(w, r, http.StatusOK, response)
}

// Close releases handler resources (database connections, etc.)
func (h *Handler) Close() error {
	if h.activityRepo != nil {
		return h.activityRepo.Close()
	}
	return nil
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

func (h *Handler) handleDistancesWithParam(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}
	h.handleDistances(w, r, year)
}

// handleDistances serves legacy cycling distance data from PostgreSQL.
// DEPRECATED: Use /activities/{year}/metrics?sport=cycling instead.
func (h *Handler) handleDistances(w http.ResponseWriter, r *http.Request, year string) {
	if h.activityRepo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, "Database not available")
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	yearInt, _ := strconv.Atoi(year) // Already validated
	distances, err := h.activityRepo.GetDistances(r.Context(), yearInt)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err, "year", year)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Internal server error",
			fmt.Sprintf("Database query failed: %v", err),
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	h.respondJSON(w, r, http.StatusOK, distances)
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
		err := apierrors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		apierrors.WriteError(w, r, err, h.corsHandler)
		return "", false
	}
	return year, true
}

// validateAndGetSport extracts and validates the sport query parameter.
// Returns the sport name and true if valid, or writes an error response and returns false.
func (h *Handler) validateAndGetSport(w http.ResponseWriter, r *http.Request) (string, bool) {
	sport := r.URL.Query().Get("sport")
	if sport == "" {
		err := apierrors.NewAPIError(http.StatusBadRequest, "Missing 'sport' query parameter")
		apierrors.WriteError(w, r, err, h.corsHandler)
		return "", false
	}

	if !h.sportConfig.ValidateSport(sport) {
		err := apierrors.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid sport: %s", sport))
		apierrors.WriteError(w, r, err, h.corsHandler)
		return "", false
	}

	return sport, true
}

// handleMetrics serves sport-specific metrics data from PostgreSQL.
func (h *Handler) handleMetrics(w http.ResponseWriter, r *http.Request, year string) {
	sport, ok := h.validateAndGetSport(w, r)
	if !ok {
		return
	}

	if h.activityRepo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, "Database not available")
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	yearInt, _ := strconv.Atoi(year) // Already validated
	metrics, err := h.activityRepo.GetSportMetrics(r.Context(), yearInt, sport)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err, "year", year, "sport", sport)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Internal server error",
			fmt.Sprintf("Database query failed: %v", err),
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	h.respondJSON(w, r, http.StatusOK, metrics)
}

// handleSource serves sport-specific source data from PostgreSQL.
func (h *Handler) handleSource(w http.ResponseWriter, r *http.Request, year string) {
	sport, ok := h.validateAndGetSport(w, r)
	if !ok {
		return
	}

	if h.activityRepo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, "Database not available")
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	yearInt, _ := strconv.Atoi(year) // Already validated
	summary, err := h.activityRepo.GetDailySummary(r.Context(), yearInt, sport)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err, "year", year, "sport", sport)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Internal server error",
			fmt.Sprintf("Database query failed: %v", err),
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	h.respondJSON(w, r, http.StatusOK, summary)
}

// handleMetadata serves year metadata (all sports) from PostgreSQL.
func (h *Handler) handleMetadata(w http.ResponseWriter, r *http.Request, year string) {
	if h.activityRepo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, "Database not available")
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	yearInt, _ := strconv.Atoi(year) // Already validated
	metadata, err := h.activityRepo.GetYearMetadata(r.Context(), yearInt)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err, "year", year)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Internal server error",
			fmt.Sprintf("Database query failed: %v", err),
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	h.respondJSON(w, r, http.StatusOK, metadata)
}

// handleSportConfig serves the sport configuration JSON.
func (h *Handler) handleSportConfig(w http.ResponseWriter, r *http.Request) {
	// Get embedded sport config JSON
	data := config.GetRawConfigJSON()
	if len(data) == 0 {
		logger.Logger.Error("Embedded sport config is empty")
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Failed to load sport config",
			"Embedded sport config is not available",
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Validate it's valid JSON without unmarshaling
	if !json.Valid(data) {
		logger.Logger.Error("Embedded sport config is invalid JSON")
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Invalid sport config",
			"JSON validation failed",
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Write raw JSON directly (no marshal/unmarshal cycle)
	h.respondRawJSON(w, r, http.StatusOK, data)
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
