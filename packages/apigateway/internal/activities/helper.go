package activities

import (
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// respondProtobuf marshals a protobuf message to JSON using protojson.
// Uses UseProtoNames: false to emit camelCase keys (default protojson behavior).
func (h *Handler) respondProtobuf(w http.ResponseWriter, r *http.Request, msg proto.Message) {
	if msg == nil {
		server.RespondJSON(w, r, http.StatusOK, nil, h.logger)
		return
	}

	marshaler := protojson.MarshalOptions{
		UseProtoNames:   false,
		EmitUnpopulated: true,
	}

	data, err := marshaler.Marshal(msg)
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
