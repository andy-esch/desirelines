import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, Source, Layer, NavigationControl } from "react-map-gl/mapbox";
import type { MapRef, ErrorEvent } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LineLayerSpecification,
  LngLatBoundsLike,
} from "mapbox-gl";
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
  /**
   * Cross-filter expression for the route layer (e.g. the filtered `activity_id`
   * set from `useRouteFilters`). `null`/omitted = show all routes — used while the
   * dataset is still loading or failed, so the map degrades to the full set rather
   * than going blank.
   */
  filter?: FilterSpecification | null;
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
 * Mapbox GL slippy map (via react-map-gl) rendering activity routes from the MVT
 * tile endpoint.
 *
 * Lazy-loaded (see `RoutesPage`) so `mapbox-gl` / `react-map-gl` and the CSS stay
 * out of the main bundle and off every non-map page. The map, MVT source, line
 * layer, and theme are declarative props; only the two things that are inherently
 * imperative remain hand-managed:
 *   - `transformRequest` reads the auth token synchronously, so the token is held
 *     in a ref (Mapbox can't `await` inside the request transform);
 *   - the default-viewport fit re-runs only on a *genuine* region change (guarded
 *     by the fitted regionId) so a background query refetch doesn't snap the map
 *     back over the user's pan/zoom.
 */
export default function RouteMap({
  accessToken,
  tileTemplateUrl,
  apiBaseUrl,
  getAuthToken,
  refreshAuthToken,
  colorExpression,
  filter,
  defaultViewport,
  isDark,
}: RouteMapProps) {
  const mapRef = useRef<MapRef>(null);

  // Auth inputs read synchronously from inside Mapbox callbacks. Kept in refs
  // (synced each render) so `transformRequest` / `onError` stay stable — react-map-gl
  // applies `transformRequest` once at construction, so it must close over refs,
  // not the latest prop identity.
  const getAuthTokenRef = useRef(getAuthToken);
  const refreshAuthTokenRef = useRef(refreshAuthToken);
  useEffect(() => {
    getAuthTokenRef.current = getAuthToken;
    refreshAuthTokenRef.current = refreshAuthToken;
  });

  // regionId of the viewport we've already fitted, so background query refetches
  // (new object, same region) don't snap the map back over the user's pan/zoom.
  // Seeded with the initial viewport's id since `initialViewState` fits it on mount.
  const fittedRegionIdRef = useRef<number | null>(defaultViewport?.regionId ?? null);

  // Bumped to force a clean tile re-fetch after a token refresh: remounting the
  // <Source> (via key) does removeSource/addSource under the hood, which Mapbox
  // needs because it won't retry tiles stuck in the "errored" state on its own.
  const [reloadNonce, setReloadNonce] = useState(0);
  const refreshingRef = useRef(false);

  // Attach our Firebase ID token to internal tile requests only. Mapbox's own
  // style/sprite/glyph/telemetry requests (api.mapbox.com, events.mapbox.com) are
  // external and must NOT receive the token — `isInternalRequest` mirrors the
  // axios client. Stable identity (token via ref) so it isn't churned per render.
  const transformRequest = useCallback(
    (url: string) => {
      if (!isInternalRequest(url, apiBaseUrl)) return { url };
      const token = getAuthTokenRef.current();
      return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url };
    },
    [apiBaseUrl]
  );

  // On an *internal* unauthorized tile fetch, force a token refresh and then
  // re-request the failed tiles (via the source remount). Gating on the URL avoids
  // reacting to a Mapbox-side 401 (bad/over-restricted pk.* token), which a
  // Firebase refresh would not fix. Debounced so a burst of tile 401s triggers one
  // refresh. Other errors surface at `warn` (not debug) so basemap/style/token
  // failures stay visible in deployed builds.
  const handleError = useCallback(
    (e: ErrorEvent) => {
      const err = e.error as { status?: number; url?: string } | undefined;
      const isInternal401 =
        err?.status === 401 && (err.url === undefined || isInternalRequest(err.url, apiBaseUrl));
      if (isInternal401 && !refreshingRef.current) {
        refreshingRef.current = true;
        void refreshAuthTokenRef
          .current()
          .then(() => setReloadNonce((n) => n + 1))
          .catch((refreshErr) => {
            logger.error("[RouteMap] auth token refresh after 401 failed:", refreshErr);
          })
          .finally(() => {
            refreshingRef.current = false;
          });
        return;
      }
      logger.warn("[RouteMap] mapbox error:", e.error ?? "unknown");
    },
    [apiBaseUrl]
  );

  // Memoized so the layer's paint isn't a new object identity each render (which
  // react-map-gl would shallow-diff and re-apply); only line-color is dynamic.
  const linePaint = useMemo<NonNullable<LineLayerSpecification["paint"]>>(
    () => ({
      "line-color": colorExpression,
      "line-width": LINE_WIDTH,
      "line-opacity": 0.85,
    }),
    [colorExpression]
  );

  // Fit the default viewport when it genuinely changes region. `initialViewState`
  // already fit the region present at mount (recorded in fittedRegionIdRef), so a
  // background query refetch — same regionId, new object — is skipped, preserving
  // the user's pan/zoom.
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
    // role/aria on a wrapper (react-map-gl owns the inner container div). Size with
    // w-full/h-full: Mapbox's CSS forces `position: relative` on its container, so
    // a Tailwind `absolute inset-0` would collapse to height 0 (blank grey map).
    <div className="w-full h-full" role="region" aria-label="Map of activity routes">
      <Map
        ref={mapRef}
        mapboxAccessToken={accessToken}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
        initialViewState={
          defaultViewport
            ? {
                bounds: bboxToBounds(defaultViewport.bbox),
                fitBoundsOptions: { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM },
              }
            : { longitude: 0, latitude: 20, zoom: 1 }
        }
        transformRequest={transformRequest}
        onError={handleError}
        attributionControl={true}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" />
        {/* Remount on reloadNonce to force a clean tile re-fetch after a 401 refresh. */}
        <Source
          key={reloadNonce}
          id={SOURCE_ID}
          type="vector"
          tiles={[tileTemplateUrl]}
          minzoom={0}
          maxzoom={14}
          // Promote the MVT `activity_id` property to the feature id (per
          // source-layer). Harmless to the property-based `filter` below; it's the
          // prerequisite for `feature-state` hover/click highlighting (next step),
          // which silently no-ops on vector tiles without a feature id.
          promoteId={{ [SOURCE_LAYER]: "activity_id" }}
        >
          <Layer
            id={LAYER_ID}
            type="line"
            source-layer={SOURCE_LAYER}
            // Spread `filter` only when present — null/absent ⇒ no filter (show all).
            // (Spread, not `filter={... ?? undefined}`, for exactOptionalPropertyTypes.)
            {...(filter ? { filter } : {})}
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={linePaint}
          />
        </Source>
      </Map>
    </div>
  );
}
