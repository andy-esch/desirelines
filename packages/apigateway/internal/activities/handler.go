// Package activities provides HTTP handlers for activity data endpoints.
//
// Endpoints handled:
//   - GET /activities/{year}/metadata - Year totals for all sports
//   - GET /activities/{year}/metrics?sport=X - Cumulative timeseries
//   - GET /activities/{year}/source?sport=X - Daily summaries
//   - GET /activities - Paginated activity list
//   - GET /activities/{id} - Single activity by ID
//
// All endpoints require authentication (handled by middleware).
package activities

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/andy-esch/desirelines/packages/apigateway/apierrors"
	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/validate"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/go-chi/chi/v5"
)

const (
	errMsgDatabaseUnavailable = "Database not available"
	errMsgInternalServerError = "Internal server error"
)

// Handler holds dependencies for activity handlers.
type Handler struct {
	repo        repository.ActivityRepository
	sportConfig *config.SportConfig
	corsHandler apierrors.CORSHandler
}

// NewHandler creates a new activities handler.
func NewHandler(repo repository.ActivityRepository, sportConfig *config.SportConfig, corsHandler apierrors.CORSHandler) *Handler {
	return &Handler{
		repo:        repo,
		sportConfig: sportConfig,
		corsHandler: corsHandler,
	}
}

// HandleMetadata serves year metadata (all sports) from PostgreSQL.
// GET /activities/{year}/metadata
func (h *Handler) HandleMetadata(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}

	if h.repo == nil {
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

	metadata, err := h.repo.GetYearMetadata(r.Context(), yearInt)
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

	server.RespondJSON(w, r, http.StatusOK, metadata, h.corsHandler)
}

// HandleMetrics serves sport-specific metrics data from PostgreSQL.
// Supports optional from/to query params for date-range queries (can span years).
// Without from/to, falls back to year-based query for backwards compatibility.
// GET /activities/{year}/metrics?sport=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]
func (h *Handler) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}

	sportTypes, ok := h.validateAndGetSportTypes(w, r)
	if !ok {
		return
	}

	if h.repo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Check for optional date range params
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")

	// Validate date range if provided
	if errMsg := validate.DateRange(fromStr, toStr); errMsg != "" {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, errMsg)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	var metrics *repository.SportMetrics
	var err error

	if fromStr != "" && toStr != "" {
		// Use date-range query (can span years)
		metrics, err = h.repo.GetSportMetricsByDateRange(r.Context(), fromStr, toStr, sportTypes)
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
		metrics, err = h.repo.GetSportMetrics(r.Context(), yearInt, sportTypes)
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

	server.RespondJSON(w, r, http.StatusOK, metrics, h.corsHandler)
}

// HandleSource serves sport-specific source data from PostgreSQL.
// GET /activities/{year}/source?sport=X
func (h *Handler) HandleSource(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}

	sportTypes, ok := h.validateAndGetSportTypes(w, r)
	if !ok {
		return
	}

	if h.repo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	yearInt, err := strconv.Atoi(year)
	if err != nil {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		apierrors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	summary, err := h.repo.GetDailySummary(r.Context(), yearInt, sportTypes)
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

	server.RespondJSON(w, r, http.StatusOK, summary, h.corsHandler)
}

// HandleGetActivity serves a single activity by ID.
// GET /activities/{id}
func (h *Handler) HandleGetActivity(w http.ResponseWriter, r *http.Request) {
	if h.repo == nil {
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

	activity, err := h.repo.GetActivityByID(r.Context(), id)
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

	server.RespondJSON(w, r, http.StatusOK, activity, h.corsHandler)
}

// HandleListActivities serves a paginated list of activities.
// GET /activities?from=2025-01-01&to=2025-12-31&sport=cycling&limit=20&cursor=...
func (h *Handler) HandleListActivities(w http.ResponseWriter, r *http.Request) {
	if h.repo == nil {
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
		if !validate.Date(fromStr) {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'from' date format (expected YYYY-MM-DD)")
			apierrors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
		filter.From = &fromStr
	}

	// Parse 'to' date
	if toStr := query.Get("to"); toStr != "" {
		if !validate.Date(toStr) {
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

	result, err := h.repo.ListActivities(r.Context(), filter)
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

	server.RespondJSON(w, r, http.StatusOK, result, h.corsHandler)
}

// validateAndGetYear extracts and validates the year path parameter.
// Returns the year string and true if valid, or writes an error response and returns false.
func (h *Handler) validateAndGetYear(w http.ResponseWriter, r *http.Request) (string, bool) {
	year := chi.URLParam(r, "year")
	if !validate.Year(year) {
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
