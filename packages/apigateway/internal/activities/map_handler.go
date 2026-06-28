package activities

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/repository"
	activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
	"github.com/go-chi/chi/v5"
)

// mapDBTimeout is the timeout for the spatial map queries (MVT tiles, region
// summary, dataset), which are heavier than typical queries due to their PostGIS
// operations: ST_Simplify (zoom-simplified tile lines), ST_AsMVTGeom/ST_AsMVT +
// ST_Intersects (tiles), ST_SnapToGrid/ST_Centroid (the low-zoom tile density
// binning), and ST_Extent (region summary).
const mapDBTimeout = 30 * time.Second

// mapCacheControl is the cache policy for the routes-map endpoints. It overrides
// the auth group's no-store default: tiles and region summaries are stable per
// user/day and expensive to regenerate, and `private` keeps them out of shared
// caches, so a short private cache is safe and worthwhile.
const mapCacheControl = "private, max-age=300, must-revalidate"

// maxTileZoom bounds the z coordinate accepted by the vector-tile endpoint.
const maxTileZoom = 22

// mvtContentType is the IANA media type for Mapbox Vector Tiles.
const mvtContentType = "application/vnd.mapbox-vector-tile"

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

// HandleMapTile serves a Mapbox Vector Tile of the user's geo-bearing routes.
// Virtual/indoor activities (no region tags) are excluded. An empty-but-valid
// tile is returned for tiles with no features (never a 404).
// GET /activities/map/tiles/{z}/{x}/{y}
func (h *Handler) HandleMapTile(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	z, x, y, ok := h.parseTileCoords(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), mapDBTimeout)
	defer cancel()

	tile, err := h.repo.GetMapTile(ctx, userID, z, x, y)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "operation", "get_map_tile")
		h.writeError(w, r, http.StatusInternalServerError, errMsgInternalServerError)
		return
	}

	w.Header().Set("Content-Type", mvtContentType)
	w.Header().Set("Cache-Control", mapCacheControl)
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write(tile); werr != nil {
		h.logger.Error("Failed to write tile response", "error", werr, "operation", "get_map_tile")
	}
}

// regionKindPriority returns the default-map-viewport priority for a region kind:
// a metro CBSA is the natural "home turf" zoom; micro CBSA and county are
// fallbacks; 'global' (the earth catch-all) is the last resort. Lower = higher
// priority; unknown kinds rank below all known ones. A switch (not a package-level
// map) keeps this free of mutable global state.
func regionKindPriority(kind string) int {
	switch kind {
	case "cbsa_metro":
		return 0
	case "cbsa_micro":
		return 1
	case "county":
		return 2
	case "global":
		return 3
	default:
		return 99
	}
}

// pickDefaultViewport returns the region to fit the map to on load: the densest
// region of the highest-priority kind present. `regions` is assumed ordered by
// activity count desc, so the first region of a given kind is that kind's densest.
// Ranking within a single kind sidesteps the tag-all skew (an activity is counted
// in both its county and its overlapping CBSA), which makes a raw cross-kind
// "densest" comparison meaningless. Returns nil when there are no regions.
func pickDefaultViewport(regions []repository.RegionSummary) *repository.RegionSummary {
	best, bestPriority := -1, 100
	for i := range regions {
		if p := regionKindPriority(regions[i].Kind); p < bestPriority {
			best, bestPriority = i, p
		}
	}
	if best < 0 {
		return nil
	}
	return &regions[best]
}

// HandleMapRegions serves per-region activity counts and bounding boxes so the
// frontend can default the map viewport to the densest region.
// GET /activities/map/regions
func (h *Handler) HandleMapRegions(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), mapDBTimeout)
	defer cancel()

	regions, err := h.repo.GetMapRegionSummary(ctx, userID)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "operation", "get_map_regions")
		h.writeError(w, r, http.StatusInternalServerError, errMsgInternalServerError)
		return
	}

	resp := repository.RegionsResponse{
		Regions:         regions,
		DefaultViewport: pickDefaultViewport(regions),
	}

	w.Header().Set("Cache-Control", mapCacheControl)
	server.RespondJSON(w, http.StatusOK, resp, h.logger)
}

// HandleMapDataset serves the full set of the user's geo-bearing activities with
// scalars + region tag ids (+ optional bbox) in one response, powering the
// routes-map client-side cross-filter model (map setFilter, charts, activity
// list, region filter). Virtual/indoor activities (no region tags) are excluded.
// Not paginated — single-user scale.
// GET /activities/map/dataset
func (h *Handler) HandleMapDataset(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.getUserID(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), mapDBTimeout)
	defer cancel()

	activities, err := h.repo.GetMapDataset(ctx, userID)
	if err != nil {
		h.logger.Error("Database query failed", "error", err, "operation", "get_map_dataset")
		h.writeError(w, r, http.StatusInternalServerError, errMsgInternalServerError)
		return
	}

	// Map raw Strava sport types to app sport categories (e.g., "Ride" → "cycling").
	for _, a := range activities {
		a.Sport = h.sportConfig.GetCategoryForStravaType(a.Sport)
	}

	resp := &activitiesv1.MapDatasetResponse{
		Activities: activities,
	}

	w.Header().Set("Cache-Control", mapCacheControl)
	h.respondProtobuf(w, r, resp)
}
