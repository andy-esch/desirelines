package activities

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// routesDBTimeout is the timeout for the spatial routes query, which is heavier
// than typical queries due to PostGIS ST_Translate and ST_Simplify operations.
const routesDBTimeout = 30 * time.Second

// HandleRoutes serves normalized route geometries for the abstract art visualization.
// GET /activities/routes?limit=500
func (h *Handler) HandleRoutes(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	limit := repository.DefaultRoutesLimit
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed < 1 || parsed > repository.MaxRoutesLimit {
			apiErr := gcplog.NewAPIError(http.StatusBadRequest, "Invalid 'limit' (must be 1-1000)")
			gcplog.WriteError(w, r, apiErr, h.logger)
			return
		}
		limit = parsed
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

	w.Header().Set("Cache-Control", "private, max-age=3600")
	server.RespondJSON(w, r, http.StatusOK, routes, h.logger)
}
