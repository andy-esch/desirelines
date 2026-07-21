package activities

import (
	"context"
	"net/http"
	"sort"

	"github.com/andy-esch/desirelines/packages/apigateway/pkg/validate"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
	"github.com/andy-esch/desirelines/packages/shared/apierrors"
)

// HandleActivitySummary serves (month × sport × geographic) activity buckets.
// GET /activities/summary?from=2025-01-01&to=2025-12-31&sports=cycling,running
//
// Query semantics match the activities list: from/to are inclusive local
// dates, and ?sports= takes comma-joined categories (absent = all sports,
// unknown category → 400). Buckets come back keyed by app category — the SQL
// groups by raw Strava sport_type, so buckets whose types collapse onto one
// category (Ride + VirtualRide → cycling) are merged here — sorted by month,
// then sport, then geographic (false first), the same stable order the charts
// client-side aggregation produces.
func (h *Handler) HandleActivitySummary(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	filter, apiErr := h.parseAggregateFilter(r)
	if !apiErr.IsZero() {
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}
	filter.UserID = userID

	ctx, cancel := context.WithTimeout(r.Context(), h.dbTimeout)
	defer cancel()

	buckets, err := h.repo.AggregateActivities(ctx, *filter)
	if err != nil {
		h.logger.Error("Database query failed", "error", err)
		h.writeError(w, r, http.StatusInternalServerError, errMsgInternalServerError)
		return
	}

	h.respondProtobuf(w, r, &activitiesv1.AggregateActivitiesResponse{
		Buckets: h.mergeBucketsByCategory(buckets),
	})
}

// parseAggregateFilter parses and validates query parameters for the activity
// summary. Returns a zero-value APIError (Status=0) on success.
func (h *Handler) parseAggregateFilter(r *http.Request) (*repository.ActivityAggregateFilter, apierrors.APIError) {
	query := r.URL.Query()
	filter := repository.ActivityAggregateFilter{}

	if fromStr := query.Get("from"); fromStr != "" {
		if !validate.Date(fromStr) {
			return nil, apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'from' date format (expected YYYY-MM-DD)")
		}
		filter.From = &fromStr
	}

	if toStr := query.Get("to"); toStr != "" {
		if !validate.Date(toStr) {
			return nil, apierrors.NewAPIError(http.StatusBadRequest, "Invalid 'to' date format (expected YYYY-MM-DD)")
		}
		filter.To = &toStr
	}

	if sportsStr := query.Get("sports"); sportsStr != "" {
		sportTypes, apiErr := h.resolveSportsList(sportsStr)
		if !apiErr.IsZero() {
			return nil, apiErr
		}
		filter.SportTypes = sportTypes
	}

	return &filter, apierrors.APIError{}
}

// mergeBucketsByCategory re-keys raw Strava sport_type buckets by app category
// and merges the ones that collapse onto the same (month, category, geographic)
// cell, summing their measures. Sorted month → sport → geographic (false
// first) to match the client aggregation's stable ordering contract.
func (h *Handler) mergeBucketsByCategory(buckets []*activitiesv1.ActivityBucket) []*activitiesv1.ActivityBucket {
	type cell struct {
		month, sport string
		geographic   bool
	}
	merged := make(map[cell]*activitiesv1.ActivityBucket, len(buckets))
	for _, b := range buckets {
		k := cell{b.Month, h.sportConfig.GetCategoryForStravaType(b.Sport), b.Geographic}
		m := merged[k]
		if m == nil {
			merged[k] = &activitiesv1.ActivityBucket{
				Month:             k.month,
				Sport:             k.sport,
				Geographic:        k.geographic,
				Count:             b.Count,
				MovingTimeSeconds: b.MovingTimeSeconds,
				DistanceMeters:    b.DistanceMeters,
			}
			continue
		}
		m.Count += b.Count
		m.MovingTimeSeconds += b.MovingTimeSeconds
		m.DistanceMeters += b.DistanceMeters
	}

	out := make([]*activitiesv1.ActivityBucket, 0, len(merged))
	for _, b := range merged {
		out = append(out, b)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Month != out[j].Month {
			return out[i].Month < out[j].Month
		}
		if out[i].Sport != out[j].Sport {
			return out[i].Sport < out[j].Sport
		}
		return !out[i].Geographic && out[j].Geographic
	})
	return out
}
