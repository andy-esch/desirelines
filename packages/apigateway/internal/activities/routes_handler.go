package activities

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	"github.com/go-chi/chi/v5"
)

// routesDBTimeout is the timeout for the spatial routes/map queries (route art,
// MVT tiles, region summary), which are heavier than typical queries due to their
// PostGIS operations (ST_Translate/ST_Simplify, ST_AsMVT, ST_Intersects).
const routesDBTimeout = 30 * time.Second

// mapCacheControl is the cache policy for the routes-map endpoints. It overrides
// the auth group's no-store default: tiles and region summaries are stable per
// user/day and expensive to regenerate, and `private` keeps them out of shared
// caches, so a short private cache is safe and worthwhile.
const mapCacheControl = "private, max-age=300, must-revalidate"

// maxTileZoom bounds the z coordinate accepted by the vector-tile endpoint.
const maxTileZoom = 22

// mvtContentType is the IANA media type for Mapbox Vector Tiles.
const mvtContentType = "application/vnd.mapbox-vector-tile"

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
			h.writeError(w, r, http.StatusBadRequest, "Invalid 'limit' (must be 1-"+strconv.Itoa(repository.MaxRoutesLimit)+")")
			return
		}
		limit = parsed
	}

	ctx, cancel := context.WithTimeout(r.Context(), routesDBTimeout)
	defer cancel()

	routes, err := h.repo.GetNormalizedRoutes(ctx, userID, limit)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "operation", "get_normalized_routes")
		h.writeError(w, r, http.StatusInternalServerError, errMsgInternalServerError)
		return
	}

	// Map raw Strava sport types to category names
	for i := range routes {
		routes[i].Sport = h.sportConfig.GetCategoryForStravaType(routes[i].Sport)
	}

	resp := repository.RoutesResponse{
		Routes: routes,
	}

	w.Header().Set("Cache-Control", mapCacheControl)
	server.RespondJSON(w, r, http.StatusOK, resp, h.logger)
}

// parseTileCoords parses and validates the z/x/y path params.
// Writes a 400 and returns ok=false on invalid or out-of-range coordinates.
func (h *Handler) parseTileCoords(w http.ResponseWriter, r *http.Request) (z, x, y int, ok bool) {
	z, errZ := strconv.Atoi(chi.URLParam(r, "z"))
	x, errX := strconv.Atoi(chi.URLParam(r, "x"))
	y, errY := strconv.Atoi(chi.URLParam(r, "y"))
	if errZ != nil || errX != nil || errY != nil || z < 0 || z > maxTileZoom {
		h.writeError(w, r, http.StatusBadRequest, "Invalid tile coordinates")
		return 0, 0, 0, false
	}
	// At zoom z there are 2^z tiles per axis, indexed 0..2^z-1.
	bound := 1 << uint(z)
	if x < 0 || y < 0 || x >= bound || y >= bound {
		h.writeError(w, r, http.StatusBadRequest, "Tile coordinates out of range for zoom")
		return 0, 0, 0, false
	}
	return z, x, y, true
}

// HandleRouteTile serves a Mapbox Vector Tile of the user's geo-bearing routes.
// Virtual/indoor activities (no region tags) are excluded. An empty-but-valid
// tile is returned for tiles with no features (never a 404).
// GET /activities/map/tiles/{z}/{x}/{y}
func (h *Handler) HandleRouteTile(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	z, x, y, ok := h.parseTileCoords(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), routesDBTimeout)
	defer cancel()

	tile, err := h.repo.GetRouteTile(ctx, userID, z, x, y)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "operation", "get_route_tile")
		h.writeError(w, r, http.StatusInternalServerError, errMsgInternalServerError)
		return
	}

	w.Header().Set("Content-Type", mvtContentType)
	w.Header().Set("Cache-Control", mapCacheControl)
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write(tile); werr != nil {
		h.logger.Error("Failed to write tile response", "error", werr, "operation", "get_route_tile")
	}
}

// HandleRouteRegions serves per-region activity counts and bounding boxes so the
// frontend can default the map viewport to the densest region.
// GET /activities/map/regions
func (h *Handler) HandleRouteRegions(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), routesDBTimeout)
	defer cancel()

	regions, err := h.repo.GetRouteRegionSummary(ctx, userID)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "operation", "get_route_regions")
		h.writeError(w, r, http.StatusInternalServerError, errMsgInternalServerError)
		return
	}

	resp := repository.RegionsResponse{Regions: regions}

	w.Header().Set("Cache-Control", mapCacheControl)
	server.RespondJSON(w, r, http.StatusOK, resp, h.logger)
}
