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
//
// # Validation Patterns
//
// This package uses two intentional validation patterns:
//
// 1. "Write and return bool" - for validators that take ResponseWriter:
//
//	year, ok := h.validateAndGetYear(w, r)
//	if !ok { return }  // Response already written
//
// This pattern enables clean composition of multiple validations without
// repetitive WriteError calls at each step.
//
// 2. "Return error" - for pure parsing functions without ResponseWriter:
//
//	filter, apiErr := h.parseListActivitiesFilter(r)
//	if !apiErr.IsZero() { apierrors.WriteError(...); return }
//
// This pattern keeps parsing logic decoupled from HTTP response writing.
package activities

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/config"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/validate"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/go-chi/chi/v5"
)

const (
	errMsgInternalServerError = "Internal server error"
	// DefaultDBTimeout is the default timeout for database queries.
	DefaultDBTimeout = 10 * time.Second
)

// Handler holds dependencies for activity handlers.
type Handler struct {
	repo        repository.ActivityRepository
	sportConfig *config.SportConfig
	logger      *slog.Logger
	dbTimeout   time.Duration
}

// NewHandler creates a new activities handler with default timeout.
func NewHandler(repo repository.ActivityRepository, sportConfig *config.SportConfig, logger *slog.Logger) *Handler {
	return NewHandlerWithTimeout(repo, sportConfig, logger, DefaultDBTimeout)
}

// NewHandlerWithTimeout creates a new activities handler with custom timeout.
func NewHandlerWithTimeout(repo repository.ActivityRepository, sportConfig *config.SportConfig, logger *slog.Logger, dbTimeout time.Duration) *Handler {
	return &Handler{
		repo:        repo,
		sportConfig: sportConfig,
		dbTimeout:   dbTimeout,
		logger:      logger,
	}
}

// HandleMetadata serves year metadata (all sports) from PostgreSQL.
// GET /activities/{year}/metadata
func (h *Handler) HandleMetadata(w http.ResponseWriter, r *http.Request) {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}

	yearInt, err := strconv.Atoi(year)
	if err != nil {
		// This should never happen since year is validated, but handle it properly
		apiErr := gcplog.NewAPIError(http.StatusBadRequest, "Invalid year format")
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	metadata, err := h.repo.GetYearMetadata(ctx, yearInt)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "year", year)
		apiErr := gcplog.NewAPIError(
			http.StatusInternalServerError,
			errMsgInternalServerError,
		)
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Map raw Strava sport types to category names (e.g., "Ride" → "cycling")
	h.categorizeSports(metadata)

	// Cache past years (immutable) for 1 hour
	if yearInt < time.Now().Year() {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}

	h.respondProtobuf(w, r, metadata)
}

// sportQueryParams holds validated parameters for sport-based queries.
type sportQueryParams struct {
	year         int // parsed year value (only used when useDateRange is false)
	sportTypes   []string
	from         string // empty if not using date range
	to           string // empty if not using date range
	useDateRange bool
}

// validateSportQuery validates common parameters for metrics and source endpoints.
// Returns nil and writes error response if validation fails.
func (h *Handler) validateSportQuery(w http.ResponseWriter, r *http.Request) *sportQueryParams {
	yearStr, ok := h.validateAndGetYear(w, r)
	if !ok {
		return nil
	}

	// Parse year to int (validation already confirmed it's a valid 4-digit year)
	yearInt, parseErr := strconv.Atoi(yearStr)
	if parseErr != nil {
		apiErr := gcplog.NewAPIError(http.StatusBadRequest, "Invalid year format")
		gcplog.WriteError(w, r, apiErr, h.logger)
		return nil
	}

	sportTypes, ok := h.validateAndGetSportTypes(w, r)
	if !ok {
		return nil
	}

	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")

	if errMsg := validate.DateRange(fromStr, toStr); errMsg != "" {
		apiErr := gcplog.NewAPIError(http.StatusBadRequest, errMsg)
		gcplog.WriteError(w, r, apiErr, h.logger)
		return nil
	}

	// Validate year consistency if date range is present
	if fromStr != "" && toStr != "" {
		// Basic check: at least the 'from' date must match the URL year
		// This prevents "GET /activities/2020?from=2024..."
		// We allow 'to' date to be in the next year to support fiscal year logic if needed later,
		// but standard usage should be within the same year.
		if !strings.HasPrefix(fromStr, yearStr) {
			apiErr := gcplog.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Date range must start in year %s", yearStr))
			gcplog.WriteError(w, r, apiErr, h.logger)
			return nil
		}
	}

	return &sportQueryParams{
		year:         yearInt,
		sportTypes:   sportTypes,
		from:         fromStr,
		to:           toStr,
		useDateRange: fromStr != "" && toStr != "",
	}
}

// logAndRespondDBError logs a database error and writes an error response.
func (h *Handler) logAndRespondDBError(w http.ResponseWriter, r *http.Request, err error, params *sportQueryParams) {
	if params.useDateRange {
		h.logger.Error("Database query failed", "error", err, "from", params.from, "to", params.to, "sportTypes", params.sportTypes)
	} else {
		h.logger.Error("Database query failed", "error", err, "year", params.year, "sportTypes", params.sportTypes)
	}
	apiErr := gcplog.NewAPIError(
		http.StatusInternalServerError,
		errMsgInternalServerError,
	)
	gcplog.WriteError(w, r, apiErr, h.logger)
}

// HandleMetrics serves sport-specific metrics data from PostgreSQL.
// Supports optional from/to query params for date-range queries (can span years).
// Without from/to, falls back to year-based query for backwards compatibility.
// GET /activities/{year}/metrics?sport=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//
// (SportMetrics vs DailySummary). Abstracting via generics or interfaces would add complexity
// without meaningful benefit. Shared logic is already extracted (validateSportQuery,
// logAndRespondDBError, respondProtobuf). Each handler remains clear and self-contained.
//
//nolint:dupl // Intentional: HandleMetrics and HandleSource share structure but differ in types
func (h *Handler) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	params := h.validateSportQuery(w, r)
	if params == nil {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	var result *generated.SportMetrics
	var err error
	if params.useDateRange {
		result, err = h.repo.GetSportMetricsByDateRange(ctx, params.from, params.to, params.sportTypes)
	} else {
		result, err = h.repo.GetSportMetrics(ctx, params.year, params.sportTypes)
	}
	if err != nil {
		h.logAndRespondDBError(w, r, err, params)
		return
	}

	// Cache past years (immutable) for 1 hour
	currentYear := time.Now().Year()
	if !params.useDateRange && params.year < currentYear {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	} else if params.useDateRange {
		// Check if 'to' date is in a past year
		if len(params.to) >= 4 {
			toYear, _ := strconv.Atoi(params.to[:4])
			if toYear < currentYear {
				w.Header().Set("Cache-Control", "public, max-age=3600")
			}
		}
	}

	h.respondProtobuf(w, r, result)
}

// HandleSource serves sport-specific source data from PostgreSQL.
// Supports optional from/to query params for date-range queries (can span years).
// Without from/to, falls back to year-based query for backwards compatibility.
// GET /activities/{year}/source?sport=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//
//nolint:dupl // Intentional duplication - see HandleMetrics comment for rationale.
func (h *Handler) HandleSource(w http.ResponseWriter, r *http.Request) {
	params := h.validateSportQuery(w, r)
	if params == nil {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	var result *generated.DailySummary
	var err error
	if params.useDateRange {
		result, err = h.repo.GetDailySummaryByDateRange(ctx, params.from, params.to, params.sportTypes)
	} else {
		result, err = h.repo.GetDailySummary(ctx, params.year, params.sportTypes)
	}
	if err != nil {
		h.logAndRespondDBError(w, r, err, params)
		return
	}

	// Cache past years (immutable) for 1 hour
	currentYear := time.Now().Year()
	if !params.useDateRange && params.year < currentYear {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	} else if params.useDateRange {
		// Check if 'to' date is in a past year
		if len(params.to) >= 4 {
			toYear, _ := strconv.Atoi(params.to[:4])
			if toYear < currentYear {
				w.Header().Set("Cache-Control", "public, max-age=3600")
			}
		}
	}

	h.respondProtobuf(w, r, result)
}

// HandleGetActivity serves a single activity by ID.
// GET /activities/{id}
func (h *Handler) HandleGetActivity(w http.ResponseWriter, r *http.Request) {
	// Parse activity ID from path
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		apiErr := gcplog.NewAPIError(http.StatusBadRequest, "Invalid activity ID format")
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	activity, err := h.repo.GetActivityByID(ctx, id)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "activityId", id)
		apiErr := gcplog.NewAPIError(
			http.StatusInternalServerError,
			errMsgInternalServerError,
		)
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	if activity == nil {
		apiErr := gcplog.NewAPIError(http.StatusNotFound, "Activity not found")
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Map raw Strava sport type to category name (e.g., "Ride" → "cycling")
	activity.Sport = h.sportConfig.GetCategoryForStravaType(activity.Sport)

	h.respondProtobuf(w, r, activity)
}

// HandleListActivities serves a paginated list of activities.
// GET /activities?from=2025-01-01&to=2025-12-31&sport=cycling&limit=20&cursor=...
func (h *Handler) HandleListActivities(w http.ResponseWriter, r *http.Request) {
	filter, apiErr := h.parseListActivitiesFilter(r)
	if !apiErr.IsZero() {
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	result, err := h.repo.ListActivities(ctx, *filter)
	if err != nil {
		h.logger.Error("Database query failed", "error", err)
		apiErr = gcplog.NewAPIError(
			http.StatusInternalServerError,
			errMsgInternalServerError,
		)
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Map raw Strava sport types to category names (e.g., "Ride" → "cycling")
	for _, a := range result.Activities {
		a.Sport = h.sportConfig.GetCategoryForStravaType(a.Sport)
	}

	h.respondProtobuf(w, r, result)
}

// parseListActivitiesFilter parses and validates query parameters for ListActivities.
// Returns a zero-value APIError (Status=0) on success.
func (h *Handler) parseListActivitiesFilter(r *http.Request) (*repository.ActivityListFilter, gcplog.APIError) {
	query := r.URL.Query()
	filter := repository.ActivityListFilter{
		Limit: repository.DefaultListLimit,
	}

	// Parse 'from' date
	if fromStr := query.Get("from"); fromStr != "" {
		if !validate.Date(fromStr) {
			return nil, gcplog.NewAPIError(http.StatusBadRequest, "Invalid 'from' date format (expected YYYY-MM-DD)")
		}
		filter.From = &fromStr
	}

	// Parse 'to' date
	if toStr := query.Get("to"); toStr != "" {
		if !validate.Date(toStr) {
			return nil, gcplog.NewAPIError(http.StatusBadRequest, "Invalid 'to' date format (expected YYYY-MM-DD)")
		}
		filter.To = &toStr
	}

	// Parse 'sport' (optional) - maps to Strava sport types
	if sport := query.Get("sport"); sport != "" {
		if errMsg := validate.Sport(sport); errMsg != "" {
			return nil, gcplog.NewAPIError(http.StatusBadRequest, errMsg)
		}
		stravaTypes := h.sportConfig.GetStravaTypes(sport)
		if stravaTypes == nil {
			return nil, gcplog.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid sport: %s", sport))
		}
		filter.SportTypes = stravaTypes
	}

	// Parse 'limit'
	if limitStr := query.Get("limit"); limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit < 1 || limit > repository.MaxListLimit {
			return nil, gcplog.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid 'limit' (must be 1-%d)", repository.MaxListLimit))
		}
		filter.Limit = limit
	}

	// Parse 'cursor' for pagination
	if cursorStr := query.Get("cursor"); cursorStr != "" {
		if errMsg := validate.Cursor(cursorStr); errMsg != "" {
			return nil, gcplog.NewAPIError(http.StatusBadRequest, errMsg)
		}
		cursor, err := decodeCursor(cursorStr)
		if err != nil {
			return nil, gcplog.NewAPIError(http.StatusBadRequest, "Invalid cursor")
		}
		filter.Cursor = cursor
	}

	return &filter, gcplog.APIError{}
}

// validateAndGetYear extracts and validates the year path parameter.
// Returns the year string and true if valid, or writes an error response and returns false.
func (h *Handler) validateAndGetYear(w http.ResponseWriter, r *http.Request) (string, bool) {
	year := chi.URLParam(r, "year")
	if !validate.Year(year) {
		err := gcplog.NewAPIError(http.StatusBadRequest, "Invalid year format")
		gcplog.WriteError(w, r, err, h.logger)
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
		err := gcplog.NewAPIError(http.StatusBadRequest, "Missing 'sport' query parameter")
		gcplog.WriteError(w, r, err, h.logger)
		return nil, false
	}

	// Validate length to prevent oversized inputs
	if errMsg := validate.Sport(sport); errMsg != "" {
		err := gcplog.NewAPIError(http.StatusBadRequest, errMsg)
		gcplog.WriteError(w, r, err, h.logger)
		return nil, false
	}

	stravaTypes := h.sportConfig.GetStravaTypes(sport)
	if stravaTypes == nil {
		err := gcplog.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid sport: %s", sport))
		gcplog.WriteError(w, r, err, h.logger)
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
	_, err = time.Parse(time.RFC3339, parts[0])
	if err != nil {
		return nil, fmt.Errorf("invalid cursor timestamp: %w", err)
	}

	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parse id: %w", err)
	}

	// Reject non-positive IDs - activity IDs must be positive
	if id <= 0 {
		return nil, fmt.Errorf("invalid cursor: id must be positive")
	}

	return &repository.ActivityCursor{
		Timestamp: parts[0],
		ID:        id,
	}, nil
}
