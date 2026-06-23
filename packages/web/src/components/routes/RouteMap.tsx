import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, Source, Layer, NavigationControl, Popup } from "react-map-gl/mapbox";
import type { MapRef, ErrorEvent, MapMouseEvent } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LineLayerSpecification,
  LngLatBoundsLike,
} from "mapbox-gl";
import type { MapActivity, RegionSummary } from "../../api/map";
import { isInternalRequest } from "../../api/url";
import { logger } from "../../lib/logger";
import { ExternalLinkIcon } from "../ui/ExternalLinkIcon";
import {
  convertDistance,
  getDistanceLabel,
  formatHoursMinutes,
  type DistanceUnit,
} from "../../utils/units";

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

/** Crisp line; width grows with zoom so routes stay legible world→street. */
const LINE_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  4,
  0.8,
  10,
  2,
  14,
  3.5,
];
/**
 * Thicker line for the hovered/selected route, drawn by a separate highlight
 * layer filtered to those ids. (We deliberately do NOT use `feature-state` in
 * `line-width` — mapbox-gl GL JS doesn't support it there, and an invalid paint
 * expression makes the whole layer fail to render.)
 */
const HOVER_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  4,
  2,
  10,
  4,
  14,
  6,
];
const HIGHLIGHT_LAYER_ID = "routes-lines-highlight";

/** Strava deep link for an activity. */
function stravaUrl(activityId: number): string {
  return `https://www.strava.com/activities/${activityId}`;
}

/** The subset of an MVT feature we read (react-map-gl's feature type omits id/props). */
type RouteFeature = { id?: number | string; properties?: Record<string, unknown> };

/**
 * The selected route — shared between the map popover and the activity list.
 * `lng`/`lat` position the popover (a map click uses the click point; a list-row
 * click uses the route's bbox centroid). When absent, the route is still
 * highlighted but no popover shows.
 */
export interface SelectedRoute {
  id: number;
  name: string;
  distanceMeters: number;
  date: string;
  lng?: number;
  lat?: number;
}

/**
 * An imperative request to frame a bbox (e.g. a list-row or region selection).
 * `nonce` changes per request so re-selecting the same target re-fits.
 */
export interface FitRequest {
  bbox: [number, number, number, number];
  nonce: number;
}

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
  /** Display unit for the click popover's distance. */
  distanceUnit: DistanceUnit;
  /**
   * Look up an activity by id for the click popover — supplies `movingTime`, which
   * the MVT tile doesn't carry (the tile has name/distance/date). Optional: without
   * it the popover just omits the time row.
   */
  getActivity?: (id: number) => MapActivity | undefined;
  /** Selected route (controlled) — highlights the line + drives the popover. */
  selected: SelectedRoute | null;
  /** Report a selection change (map click / clear) up to the shared owner. */
  onSelect: (route: SelectedRoute | null) => void;
  /** Frame this bbox when it changes (list-row / region selection). */
  fitTo?: FitRequest | null;
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
  distanceUnit,
  getActivity,
  selected,
  onSelect,
  fitTo,
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

  // Memoized so the layer paint isn't a new object identity each render (which
  // react-map-gl would shallow-diff and re-apply); only line-color is dynamic.
  // Crisp, full-opacity neon line — no blur (a `line-blur` glow underlay produced
  // jaggedy artifacts; the clean line on the full-spectrum color reads well).
  const linePaint = useMemo<NonNullable<LineLayerSpecification["paint"]>>(
    () => ({
      "line-color": colorExpression,
      "line-width": LINE_WIDTH,
      "line-opacity": 1,
    }),
    [colorExpression]
  );

  // Hover interactivity. The hovered/selected routes are emphasized by a separate,
  // wider highlight layer filtered to their ids — NOT via `feature-state` in
  // `line-width` (mapbox-gl GL JS doesn't support feature-state there; an invalid
  // paint expression makes the whole layer fail to render → no lines at all).
  const hoveredIdRef = useRef<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const onMouseMove = useCallback((e: MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const id = (e.features?.[0] as RouteFeature | undefined)?.id;
    const nextId = typeof id === "number" || typeof id === "string" ? Number(id) : null;
    map.getCanvas().style.cursor = nextId !== null ? "pointer" : "";
    if (hoveredIdRef.current === nextId) return; // only re-render on a genuine change
    hoveredIdRef.current = nextId;
    setHoveredId(nextId);
  }, []);

  const clearHover = useCallback(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = "";
    hoveredIdRef.current = null;
    setHoveredId(null);
  }, []);

  const onClick = useCallback(
    (e: MapMouseEvent) => {
      const f = e.features?.[0] as RouteFeature | undefined;
      if (!f || f.id == null) {
        onSelect(null); // click on empty map closes the popover / clears selection
        return;
      }
      const props = f.properties ?? {};
      onSelect({
        id: Number(f.id),
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        name: typeof props.name === "string" ? props.name : "Activity",
        distanceMeters: typeof props.distance === "number" ? props.distance : 0,
        date: typeof props.date === "string" ? props.date : "",
      });
    },
    [onSelect]
  );

  const closePopup = useCallback(() => onSelect(null), [onSelect]);

  // Frame a requested bbox (list-row / region selection). Guarded by nonce so it
  // fits once per request, not on every re-render.
  const fittedNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!fitTo || fittedNonceRef.current === fitTo.nonce) return;
    fittedNonceRef.current = fitTo.nonce;
    mapRef.current?.fitBounds(bboxToBounds(fitTo.bbox), {
      padding: FIT_PADDING,
      maxZoom: MAX_FIT_ZOOM,
      duration: 600,
    });
  }, [fitTo]);

  // The hovered route + the selected route get the wider highlight layer.
  const highlightPaint = useMemo<NonNullable<LineLayerSpecification["paint"]>>(
    () => ({ "line-color": colorExpression, "line-width": HOVER_WIDTH, "line-opacity": 1 }),
    [colorExpression]
  );
  const highlightFilter = useMemo<FilterSpecification>(() => {
    const ids = [hoveredId, selected?.id ?? null].filter((id): id is number => id !== null);
    return ["in", ["get", "activity_id"], ["literal", ids]] as FilterSpecification;
  }, [hoveredId, selected]);

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
        interactiveLayerIds={[LAYER_ID]}
        onMouseMove={onMouseMove}
        onMouseLeave={clearHover}
        onClick={onClick}
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
          {/* Wider highlight for the hovered/selected route, on top of the base
              layer (filtered to those ids — no feature-state). */}
          <Layer
            id={HIGHLIGHT_LAYER_ID}
            type="line"
            source-layer={SOURCE_LAYER}
            filter={highlightFilter}
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={highlightPaint}
          />
        </Source>

        {selected && selected.lng != null && selected.lat != null && (
          <Popup
            longitude={selected.lng}
            latitude={selected.lat}
            anchor="bottom"
            offset={12}
            closeButton={false}
            // Don't auto-close on map click: otherwise clicking another line both
            // closes this popup (closeOnClick) AND fires our onClick to select the
            // new line in the same event — the two setState races and the close
            // wins, so no new popup appears. We own open/switch/close via onClick.
            closeOnClick={false}
            onClose={closePopup}
            className="routes-map-popup"
          >
            <RoutePopupCard
              selected={selected}
              distanceUnit={distanceUnit}
              movingTime={getActivity?.(selected.id)?.movingTime}
              onClose={closePopup}
            />
          </Popup>
        )}
      </Map>
    </div>
  );
}

/** Details card shown in the click `<Popup>`: title, distance, date, time, Strava link. */
function RoutePopupCard({
  selected,
  distanceUnit,
  movingTime,
  onClose,
}: {
  selected: SelectedRoute;
  distanceUnit: DistanceUnit;
  movingTime: number | undefined;
  onClose: () => void;
}) {
  const distance = `${convertDistance(selected.distanceMeters, distanceUnit).toLocaleString(
    undefined,
    { maximumFractionDigits: 1 }
  )} ${getDistanceLabel(distanceUnit)}`;
  return (
    <div className="min-w-44 max-w-64 rounded-md border border-border bg-card p-3 text-body-text shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-tight">{selected.name}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 inline-flex h-6 w-6 items-center justify-center rounded text-slate-light hover:text-body-text"
        >
          ✕
        </button>
      </div>
      <dl className="mt-2 space-y-0.5 text-xs text-slate-light">
        <div className="flex justify-between gap-4">
          <dt>Distance</dt>
          <dd className="tabular-nums text-body-text">{distance}</dd>
        </div>
        {movingTime != null && (
          <div className="flex justify-between gap-4">
            <dt>Time</dt>
            <dd className="tabular-nums text-body-text">{formatHoursMinutes(movingTime / 3600)}</dd>
          </div>
        )}
        {selected.date && (
          <div className="flex justify-between gap-4">
            <dt>Date</dt>
            <dd className="tabular-nums text-body-text">{selected.date}</dd>
          </div>
        )}
      </dl>
      <a
        href={stravaUrl(selected.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-cyan hover:underline"
      >
        View on Strava
        <ExternalLinkIcon />
      </a>
    </div>
  );
}
