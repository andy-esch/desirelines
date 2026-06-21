import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { ExpressionSpecification, LngLatBoundsLike } from "mapbox-gl";
import type { RegionSummary } from "../../api/map";
import { isInternalRequest } from "../../api/url";
import { logger } from "../../lib/logger";

/**
 * `SOURCE_LAYER` is a backend contract — it MUST be "routes" to match the layer
 * name in the MVT served by `GET /v1/activities/map/tiles/{z}/{x}/{y}`.
 * `SOURCE_ID` / `LAYER_ID` are local Mapbox handles (free choice).
 */
const SOURCE_ID = "routes-src";
const SOURCE_LAYER = "routes";
const LAYER_ID = "routes-lines";

const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";

const FIT_PADDING = 40;
/** Cap fit zoom so a degenerate (single-point) bbox doesn't zoom to the moon. */
const MAX_FIT_ZOOM = 14;

/** Line width grows with zoom so routes stay legible from world to street level. */
const LINE_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  4,
  0.6,
  10,
  1.5,
  14,
  2.5,
];

export interface RouteMapProps {
  /** Public, URL-restricted Mapbox pk.* token. */
  accessToken: string;
  /** Absolute MVT tile template URL with literal {z}/{x}/{y} placeholders. */
  tileTemplateUrl: string;
  /** API gateway base (`${apiGatewayUrl}/v1`) — used to classify internal requests. */
  apiBaseUrl: string;
  /** Reads the current Firebase ID token synchronously for tile auth headers. */
  getAuthToken: () => string | undefined;
  /** Forces a token refresh after an unauthorized tile fetch. */
  refreshAuthToken: () => Promise<void>;
  /** Data-driven per-sport line color (or a flat color before the registry loads). */
  colorExpression: ExpressionSpecification | string;
  /** Region to fit on load; null falls back to a world view. */
  defaultViewport: RegionSummary | null;
  isDark: boolean;
}

function bboxToBounds(bbox: [number, number, number, number]): LngLatBoundsLike {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/**
 * Mapbox GL slippy map rendering activity routes from the MVT tile endpoint.
 *
 * Lazy-loaded (see `RoutesPage`) so `mapbox-gl` and its CSS stay out of the main
 * bundle and off every non-map page. Mutable inputs (auth token, color
 * expression) are read through refs so they update the live map without tearing
 * it down; the map is re-created only when the token or tile URL change. Theme
 * changes swap the basemap via `setStyle` (preserving pan/zoom) rather than
 * rebuilding the map.
 */
export default function RouteMap({
  accessToken,
  tileTemplateUrl,
  apiBaseUrl,
  getAuthToken,
  refreshAuthToken,
  colorExpression,
  defaultViewport,
  isDark,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Mutable inputs read synchronously from inside Mapbox callbacks / the init
  // effect. Kept in refs (synced post-render below) so the live map can read the
  // latest values without being torn down and re-created.
  const getAuthTokenRef = useRef(getAuthToken);
  const refreshAuthTokenRef = useRef(refreshAuthToken);
  const colorRef = useRef(colorExpression);
  const viewportRef = useRef(defaultViewport);
  // Initial theme for map creation; live changes go through the setStyle effect.
  const isDarkRef = useRef(isDark);
  // regionId of the viewport we've already fitted, so background query refetches
  // (new object, same region) don't snap the map back over the user's pan/zoom.
  const fittedRegionIdRef = useRef<string | null>(null);

  // Sync refs after each render. Declared before the init effect so that on
  // mount the refs are fresh by the time the map is created.
  useEffect(() => {
    getAuthTokenRef.current = getAuthToken;
    refreshAuthTokenRef.current = refreshAuthToken;
    colorRef.current = colorExpression;
    viewportRef.current = defaultViewport;
    isDarkRef.current = isDark;
  });

  // (Re)create the map only when the token or tile URL change. Theme + viewport
  // + color are handled by the in-place effects below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    mapboxgl.accessToken = accessToken;

    const viewport = viewportRef.current;
    const map = new mapboxgl.Map({
      container,
      style: isDarkRef.current ? DARK_STYLE : LIGHT_STYLE,
      ...(viewport
        ? {
            bounds: bboxToBounds(viewport.bbox),
            fitBoundsOptions: { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM },
          }
        : { center: [0, 20], zoom: 1 }),
      attributionControl: true,
      // Attach our Firebase ID token to internal tile requests only. Mapbox's
      // own style/sprite/glyph/telemetry requests (api.mapbox.com,
      // events.mapbox.com) are external and must NOT receive the token —
      // `isInternalRequest` mirrors the axios client.
      transformRequest: (url) => {
        if (!isInternalRequest(url, apiBaseUrl)) return { url };
        const token = getAuthTokenRef.current();
        return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url };
      },
    });
    mapRef.current = map;
    // The constructor already fit `viewport` (if any) — record it so the
    // fit-on-viewport effect doesn't immediately re-fit the same region.
    fittedRegionIdRef.current = viewport?.regionId ?? null;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Adds the MVT source + line layer. Idempotent and re-run after every style
    // load (initial load AND theme `setStyle`, which wipes user layers).
    const addRoutesLayer = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "vector",
          tiles: [tileTemplateUrl],
          minzoom: 0,
          maxzoom: 14,
        });
      }
      if (!map.getLayer(LAYER_ID)) {
        map.addLayer({
          id: LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          "source-layer": SOURCE_LAYER,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": colorRef.current,
            "line-width": LINE_WIDTH,
            "line-opacity": 0.85,
          },
        });
      }
    };
    // Fires on the initial style load and after every `setStyle` (theme change).
    map.on("style.load", addRoutesLayer);

    // Force a clean re-fetch of route tiles (e.g. after a token refresh): mapbox
    // won't retry tiles stuck in the "errored" state on its own.
    const reloadRoutes = () => {
      if (!map.getStyle()) return;
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      addRoutesLayer();
    };

    // On an *internal* unauthorized tile fetch, force a token refresh and then
    // re-request the failed tiles. Gating on the URL avoids reacting to a
    // Mapbox-side 401 (bad/over-restricted pk.* token), which a Firebase refresh
    // would not fix. Debounced so a burst of tile 401s triggers one refresh.
    let refreshing = false;
    map.on("error", (e: mapboxgl.ErrorEvent) => {
      const err = e.error as { status?: number; url?: string } | undefined;
      const isInternal401 =
        err?.status === 401 && (err.url === undefined || isInternalRequest(err.url, apiBaseUrl));
      if (isInternal401 && !refreshing) {
        refreshing = true;
        void refreshAuthTokenRef
          .current()
          .then(() => {
            if (mapRef.current === map) reloadRoutes();
          })
          .catch((refreshErr) => {
            logger.error("[RouteMap] auth token refresh after 401 failed:", refreshErr);
          })
          .finally(() => {
            refreshing = false;
          });
        return;
      }
      logger.debug("[RouteMap] mapbox error:", e.error?.message ?? "unknown");
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [accessToken, tileTemplateUrl, apiBaseUrl]);

  // Swap the basemap on theme change without rebuilding the map (preserves
  // pan/zoom). The `style.load` handler re-adds the routes source + layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const target = isDark ? DARK_STYLE : LIGHT_STYLE;
    map.setStyle(target);
  }, [isDark]);

  // Update line color in place when the sport registry (color expression) loads.
  // No `isStyleLoaded()` guard: that returns false while tiles are in flight,
  // which is exactly when `sportConfig` tends to resolve — the layer existing is
  // sufficient for `setPaintProperty`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(LAYER_ID)) return;
    map.setPaintProperty(LAYER_ID, "line-color", colorExpression);
  }, [colorExpression]);

  // Fit the default viewport when it first resolves (or genuinely changes
  // region). Guarded by the fitted regionId so a background query refetch — same
  // region, new object reference — doesn't snap the map back over the user's
  // pan/zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !defaultViewport) return;
    if (fittedRegionIdRef.current === defaultViewport.regionId) return;
    fittedRegionIdRef.current = defaultViewport.regionId;
    map.fitBounds(bboxToBounds(defaultViewport.bbox), {
      padding: FIT_PADDING,
      maxZoom: MAX_FIT_ZOOM,
      duration: 0,
    });
  }, [defaultViewport]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      role="region"
      aria-label="Map of activity routes"
    />
  );
}
