// Package activities provides HTTP handlers for activity data endpoints.
//
// Endpoints handled:
//   - GET /activities/{year}/metadata - Year totals for all sports
//   - GET /activities/{year}/metrics?sport=X - Cumulative timeseries (single sport)
//   - GET /activities/{year}/metrics?sports=X,Y,Z - Cumulative timeseries (multi-sport)
//   - GET /activities/{year}/source?sport=X - Daily summaries (single sport)
//   - GET /activities/{year}/source?sports=X,Y,Z - Daily summaries (multi-sport)
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
//	year, ok := h.validateAndGetYear(w, r)  // returns int
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
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/pkg/validate"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"github.com/go-chi/chi/v5"
)

const (
	errMsgInternalServerError = "Internal server error"
	// DefaultDBTimeout is the default timeout for database queries.
	DefaultDBTimeout = 10 * time.Second
	// MaxMultiSportCount is the maximum number of sports in a ?sports= query.
	MaxMultiSportCount = 20
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

// getUserID extracts the authenticated user's ID from the request context.
// Returns the user ID and true if present, or writes a 500 error and returns false.
// An empty user ID indicates a middleware misconfiguration (route not protected by auth).
func (h *Handler) getUserID(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		h.logger.Error("Auth: user ID missing from request context (middleware misconfiguration)")
		apiErr := apierrors.NewAPIError(http.StatusInternalServerError, errMsgInternalServerError)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return "", false
	}
	return userID, true
}

// HandleMetadata serves year metadata (all sports) from PostgreSQL.
// GET /activities/{year}/metadata
func (h *Handler) HandleMetadata(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	metadata, err := h.repo.GetYearMetadata(ctx, userID, year)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "year", year)
		apiErr := apierrors.NewAPIError(
			http.StatusInternalServerError,
			errMsgInternalServerError,
		)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Map raw Strava sport types to category names (e.g., "Ride" → "cycling")
	h.categorizeSports(metadata)

	// Cache past years (immutable) for 1 hour; private prevents CDN/proxy caching
	if year < time.Now().Year() {
		w.Header().Set("Cache-Control", "private, max-age=3600")
	}

	h.respondProtobuf(w, r, metadata)
}

// defaultLocation is the fallback timezone when no tz param is provided.
// Matches the current single-user deployment (US Eastern).
var defaultLocation = func() *time.Location {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		// This should only happen if the timezone database is missing.
		// Fall back to UTC to avoid nil pointer panics later.
		return time.UTC
	}
	return loc
}()

// sportQueryParams holds validated parameters for sport-based queries.
type sportQueryParams struct {
	year         int // parsed year value (only used when useDateRange is false)
	sportTypes   []string
	from         string // empty if not using date range
	to           string // empty if not using date range
	useDateRange bool
	loc          *time.Location // user's timezone for "today" calculations
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

	fromStr, toStr, ok := h.parseDateRange(w, r, year)
	if !ok {
		return nil
	}

	return &sportQueryParams{
		year:         year,
		sportTypes:   sportTypes,
		from:         fromStr,
		to:           toStr,
		useDateRange: fromStr != "" && toStr != "",
		loc:          h.parseTimezone(r),
	}
}

// parseDateRange reads and validates the from/to query params against the URL
// year. On failure it writes the 400 response and returns ok=false. Shared by
// the single- and multi-sport validators so the two can't drift.
func (h *Handler) parseDateRange(w http.ResponseWriter, r *http.Request, year int) (from, to string, ok bool) {
	from = r.URL.Query().Get("from")
	to = r.URL.Query().Get("to")

	if errMsg := validate.DateRange(from, to); errMsg != "" {
		apierrors.WriteError(w, r, apierrors.NewAPIError(http.StatusBadRequest, errMsg), h.logger)
		return "", "", false
	}
	if errMsg := validate.DateRangeYearOverlap(from, to, year); errMsg != "" {
		apierrors.WriteError(w, r, apierrors.NewAPIError(http.StatusBadRequest, errMsg), h.logger)
		return "", "", false
	}
	return from, to, true
}

// multiSportQueryParams holds validated parameters for multi-sport queries.
// Each entry in sportCategories maps a category name (e.g. "cycling") to its Strava types.
type multiSportQueryParams struct {
	year            int
	sportCategories map[string][]string // category → Strava types (e.g. "cycling" → ["Ride", "VirtualRide"])
	allSportTypes   []string            // flattened union of all Strava types across categories
	from            string
	to              string
	useDateRange    bool
	loc             *time.Location // user's timezone for "today" calculations
}

// validateMultiSportQuery validates the ?sports=X,Y,Z parameter for multi-sport endpoints.
// Returns nil and writes error response if validation fails.
func (h *Handler) validateMultiSportQuery(w http.ResponseWriter, r *http.Request) *multiSportQueryParams {
	year, ok := h.validateAndGetYear(w, r)
	if !ok {
		return nil
	}

	sportsStr := r.URL.Query().Get("sports")
	if sportsStr == "" {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Missing 'sports' query parameter")
		apierrors.WriteError(w, r, apiErr, h.logger)
		return nil
	}

	categories := strings.Split(sportsStr, ",")
	if len(categories) > MaxMultiSportCount {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Too many sports (max %d)", MaxMultiSportCount))
		apierrors.WriteError(w, r, apiErr, h.logger)
		return nil
	}

	sportCategories := make(map[string][]string, len(categories))
	for _, cat := range categories {
		cat = strings.TrimSpace(cat)
		if cat == "" {
			continue
		}
		if errMsg := validate.Sport(cat); errMsg != "" {
			apiErr := apierrors.NewAPIError(http.StatusBadRequest, errMsg)
			apierrors.WriteError(w, r, apiErr, h.logger)
			return nil
		}
		stravaTypes := h.sportConfig.GetStravaTypes(cat)
		if stravaTypes == nil {
			apiErr := apierrors.NewAPIErrorWithLog(http.StatusBadRequest, "Invalid sport parameter", fmt.Sprintf("Invalid sport in sports list: %s", cat))
			apierrors.WriteError(w, r, apiErr, h.logger)
			return nil
		}
		sportCategories[cat] = stravaTypes
	}

	if len(sportCategories) == 0 {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "No valid sports provided")
		apierrors.WriteError(w, r, apiErr, h.logger)
		return nil
	}

	fromStr, toStr, ok := h.parseDateRange(w, r, year)
	if !ok {
		return nil
	}

	// Flatten all Strava types into a single slice for the single-query approach
	allTypes := make([]string, 0)
	for _, types := range sportCategories {
		allTypes = append(allTypes, types...)
	}

	return &multiSportQueryParams{
		year:            year,
		sportCategories: sportCategories,
		allSportTypes:   allTypes,
		from:            fromStr,
		to:              toStr,
		useDateRange:    fromStr != "" && toStr != "",
		loc:             h.parseTimezone(r),
	}
}

// isMultiSportRequest returns true if the request uses the ?sports= (plural) parameter.
func isMultiSportRequest(r *http.Request) bool {
	return r.URL.Query().Get("sports") != ""
}

// parseTimezone parses and validates the tz query parameter.
// Returns defaultLocation if tz is empty or invalid.
func (h *Handler) parseTimezone(r *http.Request) *time.Location {
	tz := r.URL.Query().Get("tz")
	if tz == "" {
		return defaultLocation
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		h.logger.Warn("Invalid timezone in query, falling back to default", "timezone", tz, "error", err)
		return defaultLocation
	}
	return loc
}

// logAndRespondDBError logs a database error and writes an error response.
func (h *Handler) logAndRespondDBError(w http.ResponseWriter, r *http.Request, err error, params *sportQueryParams) {
	if params.useDateRange {
		h.logger.Error("Database query failed", "error", err, "from", params.from, "to", params.to, "sportTypes", params.sportTypes)
	} else {
		h.logger.Error("Database query failed", "error", err, "year", params.year, "sportTypes", params.sportTypes)
	}
	apiErr := apierrors.NewAPIError(
		http.StatusInternalServerError,
		errMsgInternalServerError,
	)
	apierrors.WriteError(w, r, apiErr, h.logger)
}

// HandleMetrics serves sport-specific metrics data from PostgreSQL.
// Supports both single-sport (?sport=X) and multi-sport (?sports=X,Y,Z) queries.
// Supports optional from/to query params for date-range queries (can span years).
// GET /activities/{year}/metrics?sport=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]
// GET /activities/{year}/metrics?sports=X,Y,Z[&from=YYYY-MM-DD&to=YYYY-MM-DD]
func (h *Handler) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	if isMultiSportRequest(r) {
		h.handleMultiSportMetrics(w, r)
		return
	}

	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	params := h.validateSportQuery(w, r)
	if params == nil {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	var byStravaType map[string]*generated.SportMetrics
	var err error
	if params.useDateRange {
		byStravaType, err = h.repo.GetMultiSportMetricsByDateRange(ctx, userID, params.from, params.to, params.sportTypes)
	} else {
		byStravaType, err = h.repo.GetMultiSportMetrics(ctx, userID, params.year, params.sportTypes, params.loc)
	}
	if err != nil {
		h.logAndRespondDBError(w, r, err, params)
		return
	}

	// Merge all Strava types for this sport category into a single result
	merged, err := h.mergeMultiSportMetrics(byStravaType)
	if err != nil {
		h.logger.Error("Multi-sport metrics merge failed", "error", err)
		apiErr := apierrors.NewAPIError(http.StatusInternalServerError, errMsgInternalServerError)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}
	// Extract the single category's data (there should be exactly one after merging)
	var result *generated.SportMetrics
	for _, v := range merged {
		result = v
		break
	}
	if result == nil {
		result = &generated.SportMetrics{Timeseries: make([]*generated.CumulativeMetricsEntry, 0)}
	}

	setCachePastData(w, params.year, params.to, params.useDateRange)
	h.respondProtobuf(w, r, result)
}

// handleMultiSportMetrics handles GET /activities/{year}/metrics?sports=X,Y,Z.
// Uses a single DB query for all sports, then re-keys results from Strava types to categories.
func (h *Handler) handleMultiSportMetrics(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	params := h.validateMultiSportQuery(w, r)
	if params == nil {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	var byStravaType map[string]*generated.SportMetrics
	var err error
	if params.useDateRange {
		byStravaType, err = h.repo.GetMultiSportMetricsByDateRange(ctx, userID, params.from, params.to, params.allSportTypes)
	} else {
		byStravaType, err = h.repo.GetMultiSportMetrics(ctx, userID, params.year, params.allSportTypes, params.loc)
	}
	if err != nil {
		h.logger.Error("Database query failed during multi-sport metrics fetch", "error", err)
		apiErr := apierrors.NewAPIError(http.StatusInternalServerError, errMsgInternalServerError)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	bySport, err := h.mergeMultiSportMetrics(byStravaType)
	if err != nil {
		h.logger.Error("Multi-sport metrics merge failed", "error", err)
		apiErr := apierrors.NewAPIError(http.StatusInternalServerError, errMsgInternalServerError)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}
	result := &generated.AllSportsMetrics{
		BySport: bySport,
	}

	setCachePastData(w, params.year, params.to, params.useDateRange)
	h.respondProtobuf(w, r, result)
}

// HandleSource serves sport-specific source data from PostgreSQL.
// Supports both single-sport (?sport=X) and multi-sport (?sports=X,Y,Z) queries.
// Supports optional from/to query params for date-range queries (can span years).
// GET /activities/{year}/source?sport=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]
// GET /activities/{year}/source?sports=X,Y,Z[&from=YYYY-MM-DD&to=YYYY-MM-DD]
func (h *Handler) HandleSource(w http.ResponseWriter, r *http.Request) {
	if isMultiSportRequest(r) {
		h.handleMultiSportSource(w, r)
		return
	}

	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	params := h.validateSportQuery(w, r)
	if params == nil {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	var byStravaType map[string]*generated.DailySummary
	var err error
	if params.useDateRange {
		byStravaType, err = h.repo.GetMultiSportDailySummaryByDateRange(ctx, userID, params.from, params.to, params.sportTypes)
	} else {
		byStravaType, err = h.repo.GetMultiSportDailySummary(ctx, userID, params.year, params.sportTypes, params.loc)
	}
	if err != nil {
		h.logAndRespondDBError(w, r, err, params)
		return
	}

	// Merge all Strava types for this sport category into a single result
	merged := h.mergeMultiSportDailySummary(byStravaType)
	// Extract the single category's data (there should be exactly one after merging)
	var result *generated.DailySummary
	for _, v := range merged {
		result = v
		break
	}
	if result == nil {
		result = &generated.DailySummary{Daily: make(map[string]*generated.DailyActivity)}
	}

	setCachePastData(w, params.year, params.to, params.useDateRange)
	h.respondProtobuf(w, r, result)
}

// handleMultiSportSource handles GET /activities/{year}/source?sports=X,Y,Z.
// Uses a single DB query for all sports, then re-keys results from Strava types to categories.
func (h *Handler) handleMultiSportSource(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	params := h.validateMultiSportQuery(w, r)
	if params == nil {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	var byStravaType map[string]*generated.DailySummary
	var err error
	if params.useDateRange {
		byStravaType, err = h.repo.GetMultiSportDailySummaryByDateRange(ctx, userID, params.from, params.to, params.allSportTypes)
	} else {
		byStravaType, err = h.repo.GetMultiSportDailySummary(ctx, userID, params.year, params.allSportTypes, params.loc)
	}
	if err != nil {
		h.logger.Error("Database query failed during multi-sport source fetch", "error", err)
		apiErr := apierrors.NewAPIError(http.StatusInternalServerError, errMsgInternalServerError)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	result := &generated.AllSportsDailySummary{
		BySport: h.mergeMultiSportDailySummary(byStravaType),
	}

	setCachePastData(w, params.year, params.to, params.useDateRange)
	h.respondProtobuf(w, r, result)
}

// setCachePastData sets a private Cache-Control header if the data is from an immutable past year.
func setCachePastData(w http.ResponseWriter, year int, to string, useDateRange bool) {
	currentYear := time.Now().Year()
	isPast := false

	if !useDateRange {
		isPast = year < currentYear
	} else if len(to) >= 4 {
		if toYear, err := strconv.Atoi(to[:4]); err == nil {
			isPast = toYear < currentYear
		}
	}

	if isPast {
		w.Header().Set("Cache-Control", "private, max-age=3600")
	}
}

// HandleGetActivity serves a single activity by ID.
// GET /activities/{id}
func (h *Handler) HandleGetActivity(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	// Parse activity ID from path. Span attribute uses `activity_id` (not the
	// chi param `id`) so a Cloud Trace filter `desirelines.activity_id=<id>`
	// matches the same attribute the dispatcher stamps in
	// stampWebhookIDsOnSpan.
	otel.AddChiURLParamsAs(r, map[string]string{"id": "activity_id"})
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		apiErr := apierrors.NewAPIError(http.StatusBadRequest, "Invalid activity ID format")
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	activity, err := h.repo.GetActivityByID(ctx, userID, id)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "activityId", id)
		apiErr := apierrors.NewAPIError(
			http.StatusInternalServerError,
			errMsgInternalServerError,
		)
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	if activity == nil {
		apiErr := apierrors.NewAPIError(http.StatusNotFound, "Activity not found")
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Map raw Strava sport type to category name (e.g., "Ride" → "cycling")
	activity.Sport = h.sportConfig.GetCategoryForStravaType(activity.Sport)

	h.respondProtobuf(w, r, activity)
}

// HandleListActivities serves a paginated list of activities.
// GET /activities?from=2025-01-01&to=2025-12-31&sport=cycling&limit=20&cursor=...
func (h *Handler) HandleListActivities(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	filter, apiErr := h.parseListActivitiesFilter(r)
	if !apiErr.IsZero() {
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}
	filter.UserID = userID

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	result, err := h.repo.ListActivities(ctx, *filter)
	if err != nil {
		h.logger.Error("Database query failed", "error", err)
		apiErr = apierrors.NewAPIError(
			http.StatusInternalServerError,
			errMsgInternalServerError,
		)
		apierrors.WriteError(w, r, apiErr, h.logger)
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
func (h *Handler) parseListActivitiesFilter(r *http.Request) (*repository.ActivityListFilter, apierrors.APIError) {
	query := r.URL.Query()
	filter := repository.ActivityListFilter{
		Limit: repository.DefaultListLimit,
	}

	// Parse 'from' date
	if fromStr := query.Get("from"); fromStr != "" {
		if !validate.Date(fromStr) {
			return nil, apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'from' date format (expected YYYY-MM-DD)")
		}
		filter.From = &fromStr
	}

	// Parse 'to' date
	if toStr := query.Get("to"); toStr != "" {
		if !validate.Date(toStr) {
			return nil, apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'to' date format (expected YYYY-MM-DD)")
		}
		filter.To = &toStr
	}

	// Parse 'sport' (optional) - maps to Strava sport types
	if sport := query.Get("sport"); sport != "" {
		if errMsg := validate.Sport(sport); errMsg != "" {
			return nil, apierrors.NewAPIError(http.StatusBadRequest, errMsg)
		}
		stravaTypes := h.sportConfig.GetStravaTypes(sport)
		if stravaTypes == nil {
			return nil, apierrors.NewAPIErrorWithLog(http.StatusBadRequest, "Invalid sport parameter", fmt.Sprintf("Invalid sport: %s", sport))
		}
		filter.SportTypes = stravaTypes
	}

	// Parse 'limit'
	if limitStr := query.Get("limit"); limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit < 1 || limit > repository.MaxListLimit {
			return nil, apierrors.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid 'limit' (must be 1-%d)", repository.MaxListLimit))
		}
		filter.Limit = limit
	}

	// Parse 'cursor' for pagination
	if cursorStr := query.Get("cursor"); cursorStr != "" {
		if errMsg := validate.Cursor(cursorStr); errMsg != "" {
			return nil, apierrors.NewAPIError(http.StatusBadRequest, errMsg)
		}
		cursor, err := decodeCursor(cursorStr)
		if err != nil {
			return nil, apierrors.NewAPIError(http.StatusBadRequest, "Invalid cursor")
		}
		filter.Cursor = cursor
	}

	return &filter, apierrors.APIError{}
}

// validateAndGetYear extracts and validates the year path parameter.
// Returns the parsed year and true if valid, or writes an error response and returns false.
func (h *Handler) validateAndGetYear(w http.ResponseWriter, r *http.Request) (int, bool) {
	otel.AddChiURLParams(r, "year")
	year, ok := validate.ParseYear(chi.URLParam(r, "year"))
	if !ok {
		err := apierrors.NewAPIError(http.StatusBadRequest, "Invalid year format")
		apierrors.WriteError(w, r, err, h.logger)
		return 0, false
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
		apierrors.WriteError(w, r, err, h.logger)
		return nil, false
	}

	// Validate length to prevent oversized inputs
	if errMsg := validate.Sport(sport); errMsg != "" {
		err := apierrors.NewAPIError(http.StatusBadRequest, errMsg)
		apierrors.WriteError(w, r, err, h.logger)
		return nil, false
	}

	stravaTypes := h.sportConfig.GetStravaTypes(sport)
	if stravaTypes == nil {
		err := apierrors.NewAPIErrorWithLog(http.StatusBadRequest, "Invalid sport parameter", fmt.Sprintf("Invalid sport: %s", sport))
		apierrors.WriteError(w, r, err, h.logger)
		return nil, false
	}

	return stravaTypes, true
}

// maxCursorDecodedLength caps the length of the base64-decoded cursor
// payload before any further parsing. Legitimate cursors are
// "RFC3339-timestamp|int64-id", which fits comfortably in 64 bytes.
// This is defense-in-depth on top of validate.MaxCursorLength's bound on
// the base64 input — keeps any unexpectedly large decoded payload from
// reaching the timestamp/ID parsers.
const maxCursorDecodedLength = 64

// decodeCursor decodes a base64-encoded cursor string.
// Cursor format: "timestamp|id" encoded as base64.
func decodeCursor(s string) (*repository.ActivityCursor, error) {
	data, err := base64.URLEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decode base64: %w", err)
	}
	if len(data) > maxCursorDecodedLength {
		return nil, fmt.Errorf("cursor decoded payload too long")
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
