package activities

import (
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

var protoMarshaler = protojson.MarshalOptions{
	UseProtoNames:   false,
	EmitUnpopulated: true,
}

// respondProtobuf marshals a protobuf message to JSON using protojson.
// Uses UseProtoNames: false to emit camelCase keys (default protojson behavior).
func (h *Handler) respondProtobuf(w http.ResponseWriter, r *http.Request, msg proto.Message) {
	if msg == nil {
		server.RespondJSON(w, r, http.StatusOK, nil, h.logger)
		return
	}

	data, err := protoMarshaler.Marshal(msg)
	if err != nil {
		h.logger.Error("Error marshaling protobuf response", "error", err)
		apiErr := apierrors.NewAPIError(http.StatusInternalServerError, "Internal server error")
		apierrors.WriteError(w, r, apiErr, h.logger)
		return
	}

	server.RespondRawJSON(w, r, http.StatusOK, data, h.logger)
}

// categorizeSports maps raw Strava sport types to category names in YearMetadata.
// Updates both the Sports slice and the Totals map keys in place.
func (h *Handler) categorizeSports(metadata *generated.YearMetadata) {
	// Map Sports slice
	for i, sport := range metadata.Sports {
		metadata.Sports[i] = h.sportConfig.GetCategoryForStravaType(sport)
	}

	// Rebuild Totals map with categorized keys, merging duplicates
	// (e.g., "Ride" and "VirtualRide" both map to "cycling")
	if len(metadata.Totals) > 0 {
		remapped := make(map[string]*generated.SportTotals, len(metadata.Totals))
		for rawSport, totals := range metadata.Totals {
			category := h.sportConfig.GetCategoryForStravaType(rawSport)
			if existing, ok := remapped[category]; ok {
				// Merge totals for the same category
				mergeFloat64PtrField(&existing.DistanceMeters, totals.DistanceMeters)
				mergeFloat64PtrField(&existing.ElevationMeters, totals.ElevationMeters)
				mergeFloat64PtrField(&existing.TimeMinutes, totals.TimeMinutes)
				existing.Activities += totals.Activities
			} else {
				remapped[category] = totals
			}
		}
		metadata.Totals = remapped
	}

	// Deduplicate Sports slice (multiple raw types may map to same category)
	seen := make(map[string]bool, len(metadata.Sports))
	deduped := make([]string, 0, len(metadata.Sports))
	for _, sport := range metadata.Sports {
		if !seen[sport] {
			seen[sport] = true
			deduped = append(deduped, sport)
		}
	}
	metadata.Sports = deduped
}

// mergeMultiSportMetrics re-keys a map[stravaType]*SportMetrics into map[category]*SportMetrics.
// Multiple Strava types that map to the same category (e.g., "Ride" + "VirtualRide" → "cycling")
// have their timeseries entries merged by summing values at matching dates.
func (h *Handler) mergeMultiSportMetrics(byStravaType map[string]*generated.SportMetrics) map[string]*generated.SportMetrics {
	result := make(map[string]*generated.SportMetrics, len(byStravaType))
	for stravaType, metrics := range byStravaType {
		category := h.sportConfig.GetCategoryForStravaType(stravaType)
		existing, ok := result[category]
		if !ok {
			result[category] = metrics
			continue
		}
		// Both timeseries are dense and date-aligned by construction: the
		// postgres adapter's CROSS JOIN unnest(sports) × generate_series(date)
		// emits one cell per (sport, date), so the ordered scan yields equal
		// length with dates aligned by index. Verify that invariant rather than
		// trusting it — a length mismatch or date misalignment means a producer
		// or query changed, so bail (leave `existing` untouched) instead of
		// silently summing across mismatched dates and corrupting totals.
		if len(existing.Timeseries) != len(metrics.Timeseries) {
			h.logger.Warn("multi-sport metrics merge skipped: timeseries length mismatch",
				"category", category,
				"existing_len", len(existing.Timeseries),
				"incoming_len", len(metrics.Timeseries),
			)
			continue
		}
		mismatchIdx := -1
		for i := range metrics.Timeseries {
			if existing.Timeseries[i].Date != metrics.Timeseries[i].Date {
				mismatchIdx = i
				break
			}
		}
		if mismatchIdx >= 0 {
			h.logger.Warn("multi-sport metrics merge skipped: timeseries date misalignment",
				"category", category,
				"index", mismatchIdx,
				"existing_date", existing.Timeseries[mismatchIdx].Date,
				"incoming_date", metrics.Timeseries[mismatchIdx].Date,
			)
			continue
		}
		for i, entry := range metrics.Timeseries {
			mergeFloat64PtrField(&existing.Timeseries[i].Distance, entry.Distance)
			mergeFloat64PtrField(&existing.Timeseries[i].Elevation, entry.Elevation)
			mergeFloat64PtrField(&existing.Timeseries[i].Time, entry.Time)
			// nil-safe: previously dropped the count when one side was nil.
			mergeInt32PtrField(&existing.Timeseries[i].Activities, entry.Activities)
		}
	}
	return result
}

// mergeMultiSportDailySummary re-keys a map[stravaType]*DailySummary into map[category]*DailySummary.
// Multiple Strava types that map to the same category have their daily entries merged.
func (h *Handler) mergeMultiSportDailySummary(byStravaType map[string]*generated.DailySummary) map[string]*generated.DailySummary {
	result := make(map[string]*generated.DailySummary, len(byStravaType))
	for stravaType, summary := range byStravaType {
		category := h.sportConfig.GetCategoryForStravaType(stravaType)
		existing, ok := result[category]
		if !ok {
			result[category] = summary
			continue
		}
		// Merge daily entries
		for date, daily := range summary.Daily {
			if existingDaily, has := existing.Daily[date]; has {
				mergeFloat64PtrField(&existingDaily.DistanceMeters, daily.DistanceMeters)
				mergeFloat64PtrField(&existingDaily.ElevationMeters, daily.ElevationMeters)
				mergeFloat64PtrField(&existingDaily.TimeMinutes, daily.TimeMinutes)
				existingDaily.Activities += daily.Activities
				// Dedup defensively: an activity belongs to one sport type, so
				// ids shouldn't repeat across a category merge — but appending
				// blindly would double-count if that ever stopped holding.
				existingDaily.ActivityIds = appendUniqueInt64(existingDaily.ActivityIds, daily.ActivityIds)
			} else {
				existing.Daily[date] = daily
			}
		}
	}
	return result
}

// mergeFloat64PtrField adds source into *target, allocating if *target is nil.
func mergeFloat64PtrField(target **float64, source *float64) {
	if source == nil {
		return
	}
	if *target == nil {
		v := *source
		*target = &v
		return
	}
	**target += *source
}

// mergeInt32PtrField adds source into *target, allocating if *target is nil.
// Unlike a both-non-nil guard, this keeps the count when exactly one side is
// set (existing nil + incoming non-nil would otherwise be silently dropped).
func mergeInt32PtrField(target **int32, source *int32) {
	if source == nil {
		return
	}
	if *target == nil {
		v := *source
		*target = &v
		return
	}
	**target += *source
}

// appendUniqueInt64 appends ids from src that aren't already in dst, preserving
// order. Used to merge activity-id lists without double-counting.
func appendUniqueInt64(dst, src []int64) []int64 {
	if len(src) == 0 {
		return dst
	}
	seen := make(map[int64]struct{}, len(dst)+len(src))
	for _, id := range dst {
		seen[id] = struct{}{}
	}
	for _, id := range src {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		dst = append(dst, id)
	}
	return dst
}
