// Package apigateway provides HTTP API handlers for serving activity data
// from PostgreSQL to the web frontend.
//
// # Endpoints
//
// GET /activities/{year}/metrics?sport=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//
//	Returns cumulative metrics timeseries for a sport category.
//	- Without from/to: Returns data for the entire year
//	- With from/to: Returns data for the date range (can span years)
//	- Date range limit: 366 days maximum
//
// GET /activities/{year}/source?sport=X
//
//	Returns daily activity summaries for a sport category.
//
// GET /activities/{year}/metadata
//
//	Returns metadata about all sports for a year.
//
// GET /activities?from=&to=&sport=&limit=&cursor=
//
//	Returns paginated list of activities.
//
// GET /activities/{id}
//
//	Returns a single activity by ID.
//
// # API Contract for Empty/Missing Data
//
// The API follows a consistent pattern for handling missing data:
//
//	| Scenario              | HTTP Status | Response Body                              |
//	|-----------------------|-------------|--------------------------------------------|
//	| Year/sport has data   | 200         | { timeseries: [...] } or { sports: [...] } |
//	| Year/sport NO data    | 200         | { timeseries: [] } or { sports: [] }       |
//	| Invalid year format   | 400         | { error: "Invalid year format" }           |
//	| Invalid sport         | 400         | { error: "Invalid sport: X" }              |
//	| Invalid date format   | 400         | { error: "Invalid 'from/to' date format" } |
//	| from > to             | 400         | { error: "'from' must be before 'to'" }    |
//	| Date range too large  | 400         | { error: "Date range must not exceed..." } |
//	| Auth failure          | 401/403     | { error: "..." }                           |
//	| DB/Server error       | 500         | { error: "Internal server error" }         |
//
// Key principle: Empty data is NOT an error. The API returns 200 with empty
// arrays/objects. 404 is only used for truly non-existent resources (wrong endpoint).
package apigateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
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

		// Individual activity endpoints
		r.Get("/activities", h.handleListActivities)
		r.Get("/activities/{id}", h.handleGetActivity)
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
		Status: statusHealthy,
	}

	// Check database connectivity if enabled
	if h.activityRepo != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := h.activityRepo.Ping(ctx); err != nil {
			logger.Logger.Warn("Database health check failed", "error", err)
			response.Database = statusUnhealthy
		} else {
			response.Database = statusHealthy
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
	yearStr, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}
	h.handleMetadata(w, r, yearStr)
}

func (h *Handler) handleMetricsWithParam(w http.ResponseWriter, r *http.Request) {
	yearStr, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}
	h.handleMetrics(w, r, yearStr)
}

func (h *Handler) handleSourceWithParam(w http.ResponseWriter, r *http.Request) {
	yearStr, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}
	h.handleSource(w, r, yearStr)
}

const (
	// MinValidYear is the earliest year for which activity data can be requested.
	// Set to 2000 to allow pre-Strava historical data imports.
	MinValidYear = 2000

	// MaxValidYear is the latest year for which activity data can be requested.
	// Set to 2050 as a reasonable planning horizon (approximately one generation).
	MaxValidYear = 2050

	// Health status constants
	statusHealthy   = "healthy"
	statusUnhealthy = "unhealthy"

	// Error messages
	errMsgDatabaseUnavailable = "Database not available"
	errMsgInternalServerError = "Internal server error"
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

// validateAndGetSportTypes extracts and validates the sport query parameter.
// Returns the Strava sport_type values for the category and true if valid,
// or writes an error response and returns false.
// For example, "cycling" returns ["Ride", "VirtualRide"].
func (h *Handler) validateAndGetSportTypes(w http.ResponseWriter, r *http.Request) ([]string, bool) {
	sport := r.URL.Query().Get("sport")
	if sport == "" {
		err := apierrors.NewAPIError(http.StatusBadRequest, "Missing 'sport' query parameter")
		apierrors.WriteError(w, r, err, h.corsHandler)
		return nil, false
	}

	stravaTypes := h.sportConfig.GetStravaTypes(sport)
	if stravaTypes == nil {
		err := apierrors.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid sport: %s", sport))
		apierrors.WriteError(w, r, err, h.corsHandler)
		return nil, false
	}

	return stravaTypes, true
}

// validateSportAndYear validates sport types and year, checks database availability,
// and returns the parsed values. This consolidates common validation for metrics/source handlers.
func (h *Handler) validateSportAndYear(w http.ResponseWriter, r *http.Request, year string) ([]string, int, bool) {
	sportTypes, ok := h.validateAndGetSportTypes(w, r)
	if !ok {
		return nil, 0, false
	}

	if h.activityRepo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return nil, 0, false
	}

	yearInt, err := strconv.Atoi(year)
	if err != nil {
		// This should never happen since year is validated, but handle it properly
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return nil, 0, false
	}

	return sportTypes, yearInt, true
}

// validateDateRange validates from/to date parameters.
// Returns an error message if validation fails, empty string if valid.
func validateDateRange(fromStr, toStr string) string {
	// Either both must be provided, or neither
	if (fromStr != "" && toStr == "") || (fromStr == "" && toStr != "") {
		return "Both 'from' and 'to' must be provided together"
	}

	// If neither provided, no validation needed
	if fromStr == "" && toStr == "" {
		return ""
	}

	// Validate date formats
	if !isValidDate(fromStr) {
		return "Invalid 'from' date format (expected YYYY-MM-DD)"
	}
	if !isValidDate(toStr) {
		return "Invalid 'to' date format (expected YYYY-MM-DD)"
	}

	// Parse dates (format already validated, so errors are unexpected)
	fromDate, fromErr := time.Parse("2006-01-02", fromStr)
	if fromErr != nil {
		return "Invalid 'from' date format (expected YYYY-MM-DD)"
	}
	toDate, toErr := time.Parse("2006-01-02", toStr)
	if toErr != nil {
		return "Invalid 'to' date format (expected YYYY-MM-DD)"
	}

	// Validate: from must be <= to
	if fromDate.After(toDate) {
		return "'from' date must be before or equal to 'to' date"
	}

	// Validate: date range must not exceed 1 year (366 days)
	const maxDays = 366
	if toDate.Sub(fromDate).Hours()/24 > float64(maxDays) {
		return fmt.Sprintf("Date range must not exceed %d days", maxDays)
	}

	return ""
}

// handleMetrics serves sport-specific metrics data from PostgreSQL.
// Supports optional from/to query params for date-range queries (can span years).
// Without from/to, falls back to year-based query for backwards compatibility.
func (h *Handler) handleMetrics(w http.ResponseWriter, r *http.Request, year string) {
	sportTypes, ok := h.validateAndGetSportTypes(w, r)
	if !ok {
		return
	}

	if h.activityRepo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Check for optional date range params
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")

	// Validate date range if provided
	if errMsg := validateDateRange(fromStr, toStr); errMsg != "" {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, errMsg)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	var metrics *repository.SportMetrics
	var err error

	if fromStr != "" && toStr != "" {
		// Use date-range query (can span years)
		metrics, err = h.activityRepo.GetSportMetricsByDateRange(r.Context(), fromStr, toStr, sportTypes)
		if err != nil {
			logger.Logger.Error("Database query failed", "error", err, "from", fromStr, "to", toStr, "sportTypes", sportTypes)
			apiErr := apierrors.NewAPIErrorWithLog(
				http.StatusInternalServerError,
				errMsgInternalServerError,
				fmt.Sprintf("Database query failed: %v", err),
			)
			apierrors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
	} else {
		// Year mode - existing behavior for backwards compatibility
		yearInt, parseErr := strconv.Atoi(year)
		if parseErr != nil {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid year format")
			apierrors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
		metrics, err = h.activityRepo.GetSportMetrics(r.Context(), yearInt, sportTypes)
		if err != nil {
			logger.Logger.Error("Database query failed", "error", err, "year", year, "sportTypes", sportTypes)
			apiErr := apierrors.NewAPIErrorWithLog(
				http.StatusInternalServerError,
				errMsgInternalServerError,
				fmt.Sprintf("Database query failed: %v", err),
			)
			apierrors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
	}

	h.respondJSON(w, r, http.StatusOK, metrics)
}

// handleSource serves sport-specific source data from PostgreSQL.
//
//nolint:dupl // Similar to handleMetrics but calls different repository method
func (h *Handler) handleSource(w http.ResponseWriter, r *http.Request, year string) {
	sportTypes, yearInt, ok := h.validateSportAndYear(w, r, year)
	if !ok {
		return
	}

	summary, err := h.activityRepo.GetDailySummary(r.Context(), yearInt, sportTypes)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err, "year", year, "sportTypes", sportTypes)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			errMsgInternalServerError,
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
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	yearInt, err := strconv.Atoi(year)
	if err != nil {
		// This should never happen since year is validated, but handle it properly
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	metadata, err := h.activityRepo.GetYearMetadata(r.Context(), yearInt)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err, "year", year)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			errMsgInternalServerError,
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
//
//nolint:unparam // status is always 200 currently, but keeping for consistency and future use
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

// =============================================================================
// Individual Activity Handlers
// =============================================================================

// handleGetActivity serves a single activity by ID.
// GET /activities/{id}
func (h *Handler) handleGetActivity(w http.ResponseWriter, r *http.Request) {
	if h.activityRepo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Parse activity ID from path
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid activity ID format")
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	activity, err := h.activityRepo.GetActivityByID(r.Context(), id)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err, "activityId", id)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			errMsgInternalServerError,
			fmt.Sprintf("Database query failed: %v", err),
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	if activity == nil {
		apiErr := apierrors.NewAPIError(http.StatusNotFound, "Activity not found")
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	h.respondJSON(w, r, http.StatusOK, activity)
}

// handleListActivities serves a paginated list of activities.
// GET /activities?from=2025-01-01&to=2025-12-31&sport=cycling&limit=20&cursor=...
func (h *Handler) handleListActivities(w http.ResponseWriter, r *http.Request) {
	if h.activityRepo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Parse query parameters
	query := r.URL.Query()

	filter := repository.ActivityListFilter{
		Limit: 20, // Default
	}

	// Parse 'from' date
	if fromStr := query.Get("from"); fromStr != "" {
		if !isValidDate(fromStr) {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'from' date format (expected YYYY-MM-DD)")
			apierrors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
		filter.From = &fromStr
	}

	// Parse 'to' date
	if toStr := query.Get("to"); toStr != "" {
		if !isValidDate(toStr) {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'to' date format (expected YYYY-MM-DD)")
			apierrors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
		filter.To = &toStr
	}

	// Parse 'sport' (optional) - maps to Strava sport types
	if sport := query.Get("sport"); sport != "" {
		stravaTypes := h.sportConfig.GetStravaTypes(sport)
		if stravaTypes == nil {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid sport: %s", sport))
			apierrors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
		filter.SportTypes = stravaTypes
	}

	// Parse 'limit'
	if limitStr := query.Get("limit"); limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit < 1 || limit > 100 {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'limit' (must be 1-100)")
			apierrors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
		filter.Limit = limit
	}

	// Parse 'cursor' for pagination
	if cursorStr := query.Get("cursor"); cursorStr != "" {
		cursor, err := decodeCursor(cursorStr)
		if err != nil {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid cursor")
			apierrors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
		filter.Cursor = cursor
	}

	result, err := h.activityRepo.ListActivities(r.Context(), filter)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			errMsgInternalServerError,
			fmt.Sprintf("Database query failed: %v", err),
		)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	h.respondJSON(w, r, http.StatusOK, result)
}

// isValidDate checks if the string is a valid YYYY-MM-DD date.
func isValidDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

// decodeCursor decodes a base64-encoded cursor string.
// Cursor format: "timestamp|id" encoded as base64.
func decodeCursor(s string) (*repository.ActivityCursor, error) {
	data, err := base64.URLEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decode base64: %w", err)
	}

	parts := strings.SplitN(string(data), "|", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid cursor format")
	}

	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parse id: %w", err)
	}

	return &repository.ActivityCursor{
		Timestamp: parts[0],
		ID:        id,
	}, nil
}
