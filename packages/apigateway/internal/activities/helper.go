package activities

import (
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
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
		apiErr := gcplog.NewAPIError(http.StatusInternalServerError, "Internal server error")
		gcplog.WriteError(w, r, apiErr, h.logger)
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
		mergeFloat64Ptr := func(target **float64, source *float64) {
			if source == nil {
				return
			}
			if *target == nil {
				v := *source
				*target = &v
				return
			}
			sum := **target + *source
			*target = &sum
		}

		remapped := make(map[string]*generated.SportTotals, len(metadata.Totals))
		for rawSport, totals := range metadata.Totals {
			category := h.sportConfig.GetCategoryForStravaType(rawSport)
			if existing, ok := remapped[category]; ok {
				// Merge totals for the same category
				mergeFloat64Ptr(&existing.DistanceMeters, totals.DistanceMeters)
				mergeFloat64Ptr(&existing.ElevationMeters, totals.ElevationMeters)
				mergeFloat64Ptr(&existing.TimeMinutes, totals.TimeMinutes)
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
		// Merge: both have timeseries ordered by date, merge by index (same dense date range)
		for i, entry := range metrics.Timeseries {
			if i < len(existing.Timeseries) {
				addFloat64Ptr(existing.Timeseries[i].Distance, entry.Distance)
				addFloat64Ptr(existing.Timeseries[i].Elevation, entry.Elevation)
				addFloat64Ptr(existing.Timeseries[i].Time, entry.Time)
				if existing.Timeseries[i].Activities != nil && entry.Activities != nil {
					sum := *existing.Timeseries[i].Activities + *entry.Activities
					existing.Timeseries[i].Activities = &sum
				}
			}
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
				addFloat64Ptr(existingDaily.DistanceMeters, daily.DistanceMeters)
				addFloat64Ptr(existingDaily.ElevationMeters, daily.ElevationMeters)
				addFloat64Ptr(existingDaily.TimeMinutes, daily.TimeMinutes)
				existingDaily.Activities += daily.Activities
				existingDaily.ActivityIds = append(existingDaily.ActivityIds, daily.ActivityIds...)
			} else {
				existing.Daily[date] = daily
			}
		}
	}
	return result
}

// addFloat64Ptr adds source value into target pointer in place.
func addFloat64Ptr(target, source *float64) {
	if target != nil && source != nil {
		*target += *source
	}
}
