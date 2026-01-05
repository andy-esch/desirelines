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
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/apierrors"
	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/validate"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	"github.com/go-chi/chi/v5"
)

const (
	errMsgDatabaseUnavailable = "Database not available"
	errMsgInternalServerError = "Internal server error"
	dbTimeout                 = 10 * time.Second
)

// Handler holds dependencies for activity handlers.
type Handler struct {
	repo        repository.ActivityRepository
	sportConfig *config.SportConfig
}

// NewHandler creates a new activities handler.
func NewHandler(repo repository.ActivityRepository, sportConfig *config.SportConfig) *Handler {
	return &Handler{
		repo:        repo,
		sportConfig: sportConfig,
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
		apierrors.WriteError(w, r, apiErr)
		return
	}

	yearInt, err := strconv.Atoi(year)
	if err != nil {
		// This should never happen since year is validated, but handle it properly
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		apierrors.WriteError(w, r, apiErr)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), dbTimeout)
	defer cancel()

	metadata, err := h.repo.GetYearMetadata(ctx, yearInt)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err, "year", year)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			errMsgInternalServerError,
			fmt.Sprintf("Database query failed: %v", err),
		)
		apierrors.WriteError(w, r, apiErr)
		return
	}

	h.respondProtobuf(w, r, metadata)
}

// sportQueryParams holds validated parameters for sport-based queries.
type sportQueryParams struct {
	year         string
	yearInt      int
	sportTypes   []string
	from         string // empty if not using date range
	to           string // empty if not using date range
	useDateRange bool
}

// validateSportQuery validates common parameters for metrics and source endpoints.
// Returns nil and writes error response if validation fails.
func (h *Handler) validateSportQuery(w http.ResponseWriter, r *http.Request) *sportQueryParams {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return nil
	}

	sportTypes, ok := h.validateAndGetSportTypes(w, r)
	if !ok {
		return nil
	}

	if h.repo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr)
		return nil
	}

	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")

	if errMsg := validate.DateRange(fromStr, toStr); errMsg != "" {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, errMsg)
		apierrors.WriteError(w, r, apiErr)
		return nil
	}

	params := &sportQueryParams{
		year:         year,
		sportTypes:   sportTypes,
		from:         fromStr,
		to:           toStr,
		useDateRange: fromStr != "" && toStr != "",
	}

	if !params.useDateRange {
		yearInt, parseErr := strconv.Atoi(year)
		if parseErr != nil {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid year format")
			apierrors.WriteError(w, r, apiErr)
			return nil
		}
		params.yearInt = yearInt
	}

	return params
}

// logAndRespondDBError logs a database error and writes an error response.
func (h *Handler) logAndRespondDBError(w http.ResponseWriter, r *http.Request, err error, params *sportQueryParams) {
	if params.useDateRange {
		logger.Logger.Error("Database query failed", "error", err, "from", params.from, "to", params.to, "sportTypes", params.sportTypes)
	} else {
		logger.Logger.Error("Database query failed", "error", err, "year", params.year, "sportTypes", params.sportTypes)
	}
	apiErr := apierrors.NewAPIErrorWithLog(
		http.StatusInternalServerError,
		errMsgInternalServerError,
		fmt.Sprintf("Database query failed: %v", err),
	)
	apierrors.WriteError(w, r, apiErr)
}

// HandleMetrics serves sport-specific metrics data from PostgreSQL.
// Supports optional from/to query params for date-range queries (can span years).
// Without from/to, falls back to year-based query for backwards compatibility.
// GET /activities/{year}/metrics?sport=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//
//nolint:dupl // HandleMetrics and HandleSource share structure but operate on different types
func (h *Handler) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	params := h.validateSportQuery(w, r)
	if params == nil {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), dbTimeout)
	defer cancel()

	var result *generated.SportMetrics
	var err error
	if params.useDateRange {
		result, err = h.repo.GetSportMetricsByDateRange(ctx, params.from, params.to, params.sportTypes)
	} else {
		result, err = h.repo.GetSportMetrics(ctx, params.yearInt, params.sportTypes)
	}
	if err != nil {
		h.logAndRespondDBError(w, r, err, params)
		return
	}
	h.respondProtobuf(w, r, result)
}

// HandleSource serves sport-specific source data from PostgreSQL.
// Supports optional from/to query params for date-range queries (can span years).
// Without from/to, falls back to year-based query for backwards compatibility.
// GET /activities/{year}/source?sport=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//
//nolint:dupl // HandleSource and HandleMetrics share structure but operate on different types
func (h *Handler) HandleSource(w http.ResponseWriter, r *http.Request) {
	params := h.validateSportQuery(w, r)
	if params == nil {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), dbTimeout)
	defer cancel()

	var result *generated.DailySummary
	var err error
	if params.useDateRange {
		result, err = h.repo.GetDailySummaryByDateRange(ctx, params.from, params.to, params.sportTypes)
	} else {
		result, err = h.repo.GetDailySummary(ctx, params.yearInt, params.sportTypes)
	}
	if err != nil {
		h.logAndRespondDBError(w, r, err, params)
		return
	}
	h.respondProtobuf(w, r, result)
}

// HandleGetActivity serves a single activity by ID.
// GET /activities/{id}
func (h *Handler) HandleGetActivity(w http.ResponseWriter, r *http.Request) {
	if h.repo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr)
		return
	}

	// Parse activity ID from path
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid activity ID format")
		apierrors.WriteError(w, r, apiErr)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), dbTimeout)
	defer cancel()

	activity, err := h.repo.GetActivityByID(ctx, id)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err, "activityId", id)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			errMsgInternalServerError,
			fmt.Sprintf("Database query failed: %v", err),
		)
		apierrors.WriteError(w, r, apiErr)
		return
	}

	if activity == nil {
		apiErr := apierrors.NewAPIError(http.StatusNotFound, "Activity not found")
		apierrors.WriteError(w, r, apiErr)
		return
	}

	server.RespondJSON(w, r, http.StatusOK, activity)
}

// HandleListActivities serves a paginated list of activities.
// GET /activities?from=2025-01-01&to=2025-12-31&sport=cycling&limit=20&cursor=...
func (h *Handler) HandleListActivities(w http.ResponseWriter, r *http.Request) {
	if h.repo == nil {
		apiErr := apierrors.NewAPIError(http.StatusServiceUnavailable, errMsgDatabaseUnavailable)
		apierrors.WriteError(w, r, apiErr)
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
			apierrors.WriteError(w, r, apiErr)
			return
		}
		filter.From = &fromStr
	}

	// Parse 'to' date
	if toStr := query.Get("to"); toStr != "" {
		if !validate.Date(toStr) {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'to' date format (expected YYYY-MM-DD)")
			apierrors.WriteError(w, r, apiErr)
			return
		}
		filter.To = &toStr
	}

	// Parse 'sport' (optional) - maps to Strava sport types
	if sport := query.Get("sport"); sport != "" {
		stravaTypes := h.sportConfig.GetStravaTypes(sport)
		if stravaTypes == nil {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid sport: %s", sport))
			apierrors.WriteError(w, r, apiErr)
			return
		}
		filter.SportTypes = stravaTypes
	}

	// Parse 'limit'
	if limitStr := query.Get("limit"); limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit < 1 || limit > 100 {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'limit' (must be 1-100)")
			apierrors.WriteError(w, r, apiErr)
			return
		}
		filter.Limit = limit
	}

	// Parse 'cursor' for pagination
	if cursorStr := query.Get("cursor"); cursorStr != "" {
		cursor, err := decodeCursor(cursorStr)
		if err != nil {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid cursor")
			apierrors.WriteError(w, r, apiErr)
			return
		}
		filter.Cursor = cursor
	}

	ctx, cancel := context.WithTimeout(r.Context(), dbTimeout)
	defer cancel()

	result, err := h.repo.ListActivities(ctx, filter)
	if err != nil {
		logger.Logger.Error("Database query failed", "error", err)
		apiErr := apierrors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			errMsgInternalServerError,
			fmt.Sprintf("Database query failed: %v", err),
		)
		apierrors.WriteError(w, r, apiErr)
		return
	}

	server.RespondJSON(w, r, http.StatusOK, result)
}

// validateAndGetYear extracts and validates the year path parameter.
// Returns the year string and true if valid, or writes an error response and returns false.
func (h *Handler) validateAndGetYear(w http.ResponseWriter, r *http.Request) (string, bool) {
	year := chi.URLParam(r, "year")
	if !validate.Year(year) {
		err := apierrors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		apierrors.WriteError(w, r, err)
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
		apierrors.WriteError(w, r, err)
		return nil, false
	}

	stravaTypes := h.sportConfig.GetStravaTypes(sport)
	if stravaTypes == nil {
		err := apierrors.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid sport: %s", sport))
		apierrors.WriteError(w, r, err)
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

	// Validate timestamp format (RFC3339) to prevent database errors
	if _, err = time.Parse(time.RFC3339, parts[0]); err != nil {
		return nil, fmt.Errorf("invalid cursor timestamp: %w", err)
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
