package activities

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// routesDBTimeout is the timeout for the spatial routes query, which is heavier
// than typical queries due to PostGIS ST_Translate and ST_Simplify operations.
const routesDBTimeout = 30 * time.Second

// maxRingIntervals is the maximum number of distance rings allowed per request.
const maxRingIntervals = 10

// HandleRoutes serves normalized route geometries for the abstract art visualization.
// GET /activities/routes?limit=500&rings=8047,16093,24140 (ring radii in meters)
func (h *Handler) HandleRoutes(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	limit := repository.DefaultRoutesLimit
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed < 1 || parsed > repository.MaxRoutesLimit {
			apiErr := gcplog.NewAPIError(http.StatusBadRequest, "Invalid 'limit' (must be 1-"+strconv.Itoa(repository.MaxRoutesLimit)+")")
			gcplog.WriteError(w, r, apiErr, h.logger)
			return
		}
		limit = parsed
	}

	// Parse optional ring intervals (comma-separated meters)
	var ringMeters []int
	if ringsStr := r.URL.Query().Get("rings"); ringsStr != "" {
		parts := strings.Split(ringsStr, ",")
		if len(parts) > maxRingIntervals {
			apiErr := gcplog.NewAPIError(http.StatusBadRequest, "Too many ring intervals (max "+strconv.Itoa(maxRingIntervals)+")")
			gcplog.WriteError(w, r, apiErr, h.logger)
			return
		}
		for _, p := range parts {
			m, err := strconv.Atoi(strings.TrimSpace(p))
			if err != nil || m < 1 {
				apiErr := gcplog.NewAPIError(http.StatusBadRequest, "Invalid ring interval: "+p)
				gcplog.WriteError(w, r, apiErr, h.logger)
				return
			}
			ringMeters = append(ringMeters, m)
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), routesDBTimeout)
	defer cancel()

	routes, err := h.repo.GetNormalizedRoutes(ctx, userID, limit)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "operation", "get_normalized_routes")
		apiErr := gcplog.NewAPIError(http.StatusInternalServerError, errMsgInternalServerError)
		gcplog.WriteError(w, r, apiErr, h.logger)
		return
	}

	// Map raw Strava sport types to category names
	for i := range routes {
		routes[i].Sport = h.sportConfig.GetCategoryForStravaType(routes[i].Sport)
	}

	// Fetch distance rings if requested (best-effort: log and skip on error)
	var rings []repository.RouteRing
	if len(ringMeters) > 0 && len(routes) > 0 {
		rings, err = h.repo.GetRouteRings(ctx, userID, ringMeters)
		if err != nil {
			h.logger.Warn("Failed to fetch route rings, omitting", "error", err)
			rings = nil
		}
	}

	resp := repository.RoutesResponse{
		Routes: routes,
		Rings:  rings,
	}

	w.Header().Set("Cache-Control", "private, max-age=300, must-revalidate")
	server.RespondJSON(w, r, http.StatusOK, resp, h.logger)
}
