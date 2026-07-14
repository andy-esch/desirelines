import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map, Source, Layer, NavigationControl, Popup } from "react-map-gl/mapbox";
import type { MapRef, ErrorEvent, MapMouseEvent } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FilterSpecification,
  LineLayerSpecification,
  LngLatBoundsLike,
} from "mapbox-gl";
import type { MapActivity, RegionSummary, MapTileJSON } from "../../api/map";
import { isInternalRequest } from "../../api/url";
import { logger } from "../../lib/logger";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { FitRequest } from "../../hooks/useCameraController";
import { ExternalLinkIcon } from "../ui/ExternalLinkIcon";
import { Button } from "../ui/button";
import MapLoadingState from "./MapLoadingState";
import {
  convertDistance,
  getDistanceLabel,
  formatHoursMinutes,
  type DistanceUnit,
} from "../../utils/units";
import { formatActivityDate } from "../../utils/formatActivityDate";

/**
 * `SOURCE_LAYER` is a backend contract — it MUST be "routes" to match the layer
 * name in the MVT served by `GET /v1/activities/map/tiles/{z}/{x}/{y}`.
 * `SOURCE_ID` / `LAYER_ID` are local Mapbox handles (free choice).
 */
const SOURCE_ID = "routes-src";
const SOURCE_LAYER = "routes";
const LAYER_ID = "routes-lines";

// The LOD handoff zoom (route lines at/above it, grid-binned `route_points` density
// dots below) is no longer a local constant: it comes from the backend TileJSON via
// `tileMeta.lineMinZoom`, so client and server can't drift.
const POINTS_SOURCE_LAYER = "route_points";
const POINTS_LAYER_ID = "routes-points";

const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11";

const FIT_PADDING = 40;
/** Cap fit zoom so a degenerate (single-point) bbox doesn't zoom to the moon. */
const MAX_FIT_ZOOM = 14;
/**
 * Shared framing (padding + max zoom) for every camera fit — mount's
 * `initialViewState` and both imperative fits — so they can't drift apart.
 */
const FIT_BOUNDS_OPTIONS = { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM } as const;

/**
 * If the map hasn't emitted `load` within this window we assume it's wedged
 * (WebGL init failure, a hung style fetch on iOS WebKit, etc.) and surface a
 * retryable error instead of an indefinite grey canvas.
 *
 * Tradeoff: too short and a genuinely slow first load on a poor mobile connection
 * gets cut off; too long and a truly wedged map stares at a spinner. 15s is
 * deliberately generous — `load` fires when the *style* is ready (not all tiles),
 * which is fast even on mobile, so a working map almost always beats this. If real
 * cellular testing shows false trips, make it adaptive (e.g. key off
 * `navigator.connection.effectiveType`).
 */
const MAP_LOAD_TIMEOUT_MS = 15_000;

/**
 * Cap on user-initiated retries before the failure surface becomes terminal (drops
 * the "Try again" button). Prevents an endless loading→error→loading loop on a
 * browser that genuinely can't render the map (no WebGL, Lockdown Mode, a hard
 * network block) — there, every retry would fail identically.
 */
const MAX_RETRIES = 2;

/**
 * Bound the internal-401 → token-refresh → tile-remount recovery. A refreshed token
 * that still 401s (auth genuinely broken, not merely stale) would otherwise loop
 * forever — refresh → remount `<Source>` → 401 → refresh … — blanking tiles each
 * cycle. After this many consecutive refresh cycles we stop and surface the
 * retryable error instead. The counter resets on a full (re)mount (`onMapLoad`) and
 * after a quiet gap: a 401 this long after the previous one is a fresh incident, not
 * the same loop, so it gets a new budget.
 */
const MAX_AUTH_REFRESHES = 3;
const AUTH_REFRESH_RESET_MS = 30_000;

/**
 * Flat mercator, not GL JS v3's default globe: a routes map needs no globe, and the
 * globe path is heavier on WebGL2 — a common cause of blank/grey maps on iOS WebKit.
 * Module-level constant so react-map-gl doesn't re-diff/re-apply it every render.
 */
const MAP_PROJECTION = { name: "mercator" } as const;

/** Crisp line; width grows with zoom so routes stay legible world→street. Past z14
 *  it keeps widening for street-level presence (paired with LINE_OPACITY, which
 *  fades it as it fattens so dense areas don't turn into a solid blob). */
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
  16,
  5,
  18,
  7,
];
/**
 * Line opacity, tied to zoom as a proxy for width: fully opaque out to z14, then
 * eased down as the line fattens past it — wider strokes at street level read
 * better semi-transparent, and overlapping routes in dense areas stay legible
 * instead of merging into one blob. Applies to the base lines only; the
 * hover/selected highlight stays fully opaque so it still pops.
 */
const LINE_OPACITY: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 14, 1, 18, 0.6];
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
  16,
  8,
  18,
  10,
];
const HIGHLIGHT_LAYER_ID = "routes-lines-highlight";

/**
 * A wide, fully transparent line drawn over the visible routes purely as a
 * pointer/touch target: the visible lines are 0.8–3.5px, which is almost
 * impossible to tap on a phone. Mapbox hit-tests a line within its `line-width`,
 * so this fat invisible companion makes selection forgiving for fingers (and a
 * little more so for the mouse). It carries the same cross-filter so only visible
 * routes are selectable.
 */
const HITAREA_LAYER_ID = "routes-lines-hit";
const HIT_WIDTH = 22;
/** Static — hoisted so the paint keeps a stable identity (react-map-gl re-applies
 *  paint on a new object each render; see `linePaint`). Fully transparent. */
const HIT_PAINT: NonNullable<LineLayerSpecification["paint"]> = {
  "line-color": "#000",
  "line-opacity": 0,
  "line-width": HIT_WIDTH,
};

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
  /** Display name of the activity's sport, shown in the popup so sport isn't
   *  conveyed by the line color alone (resolved from the dataset by the page). */
  sportLabel?: string;
  lng?: number;
  lat?: number;
}

export interface RouteMapProps {
  /** Public, URL-restricted Mapbox pk.* token. */
  accessToken: string;
  /** Absolute MVT tile template URL with literal {z}/{x}/{y} placeholders. */
  tileTemplateUrl: string;
  /** Tile zoom levels (min/max + LOD switch) from the backend TileJSON — the source
   *  of truth so the client doesn't hardcode them. See `useMapTileJSON`. */
  tileMeta: MapTileJSON;
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
  /** Region framed at mount via `initialViewState` (null → world view). Only the
   *  first frame; later default-region fits arrive through `fitTo` from the parent. */
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
  // A >180° longitude span means the route wraps the SHORT way across the
  // antimeridian (date line), not the long way around the globe — a naive [min,max]
  // box would frame nearly the whole world and zoom right out. Frame the short arc
  // instead by pushing the western edge east of +180° so mapbox fits across the seam.
  if (maxLng - minLng > 180) {
    return [
      [maxLng, minLat],
      [minLng + 360, maxLat],
    ];
  }
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
  tileMeta,
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
  const isMobile = useIsMobile();

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

  // Bumped to force a clean tile re-fetch after a token refresh: remounting the
  // <Source> (via key) does removeSource/addSource under the hood, which Mapbox
  // needs because it won't retry tiles stuck in the "errored" state on its own.
  const [reloadNonce, setReloadNonce] = useState(0);
  const refreshingRef = useRef(false);
  // Consecutive 401→refresh cycles + when the last one fired — bounds the recovery
  // loop (see MAX_AUTH_REFRESHES). Refs, not state: read/updated inside the Mapbox
  // error callback, and they must not trigger a re-render.
  const authRefreshCountRef = useRef(0);
  const lastAuthErrorAtRef = useRef(0);

  // Map lifecycle for the load/error UX. `status` drives the loading spinner and
  // the retryable failure overlay; `remountKey` recreates the whole <Map> on retry
  // (a fresh GL context) — distinct from `reloadNonce`, which only re-fetches tiles.
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [remountKey, setRemountKey] = useState(0);
  // Count of retries so far; once it hits MAX_RETRIES the error surface goes terminal.
  const [retries, setRetries] = useState(0);
  // Route tiles gave up after MAX_AUTH_REFRESHES on an *already-loaded* map — the
  // basemap is fine, so instead of the full error overlay we show a dismissible
  // "routes unavailable" notice with a soft retry (re-fetch tiles, not a GL remount).
  const [tilesUnavailable, setTilesUnavailable] = useState(false);

  const retry = useCallback(() => {
    setRetries((n) => n + 1);
    setStatus("loading");
    setRemountKey((k) => k + 1);
  }, []);

  // Soft retry for the route tiles alone: reset the auth-refresh budget and re-fetch
  // tiles (source remount) without recreating the whole map / basemap.
  const retryTiles = useCallback(() => {
    authRefreshCountRef.current = 0;
    setTilesUnavailable(false);
    setReloadNonce((n) => n + 1);
  }, []);

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
      const isInternalUrl = err?.url === undefined || isInternalRequest(err.url, apiBaseUrl);
      const isInternal401 = err?.status === 401 && isInternalUrl;
      if (isInternal401 && !refreshingRef.current) {
        // A 401 well after the previous one is a fresh incident, not the same loop —
        // give it a new refresh budget.
        const now = Date.now();
        if (now - lastAuthErrorAtRef.current > AUTH_REFRESH_RESET_MS) {
          authRefreshCountRef.current = 0;
        }
        lastAuthErrorAtRef.current = now;

        if (authRefreshCountRef.current >= MAX_AUTH_REFRESHES) {
          // Refreshed tokens keep 401ing → auth is genuinely broken; stop looping
          // (each cycle blanks tiles) and surface the failure. On a not-yet-ready map
          // that's the full retryable overlay; on an already-rendered map we keep the
          // working basemap and show a dismissible "routes unavailable" notice
          // instead of condemning it. (The quiet-gap reset still lets a later pan
          // retry automatically.)
          logger.error(
            `[RouteMap] internal tile 401 persists after ${MAX_AUTH_REFRESHES} refreshes; giving up`
          );
          setStatus((s) => (s === "ready" ? s : "error"));
          setTilesUnavailable(true);
          return;
        }

        // Under budget: we're (re)attempting, so clear any stale "unavailable" notice.
        setTilesUnavailable(false);
        authRefreshCountRef.current += 1;
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
      // A failed auth on the Mapbox **style document** (bad / over-restricted `pk.*`
      // token) means the basemap genuinely can't render and a Firebase refresh can't
      // fix it — surface the retryable error now rather than waiting out the load
      // timeout on a guaranteed-blank map. Scoped to the style URL on purpose: a
      // transient 401/403 on a sub-resource (sprite/glyph/font/telemetry) degrades
      // gracefully (missing icons/labels) and must NOT condemn the whole map; the
      // load timeout still catches a true hang. Guarded so it never clobbers an
      // already-rendered ("ready") map.
      const isStyleAuthFailure =
        !isInternalUrl &&
        (err?.status === 401 || err?.status === 403) &&
        typeof err?.url === "string" &&
        err.url.includes("/styles/") &&
        // Sprites live under the style path too (…/styles/v1/.../sprite.json);
        // exclude them so a sprite 401/403 degrades gracefully (missing icons)
        // instead of condemning the whole map.
        !err.url.includes("/sprite");
      if (isStyleAuthFailure) {
        setStatus((s) => (s === "ready" ? s : "error"));
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
      "line-opacity": LINE_OPACITY,
    }),
    [colorExpression]
  );

  // Low-zoom density dots (the `route_points` layer). One dot per sport per grid cell,
  // colored by sport (same expression as the lines) and sized by that sport's
  // `activity_count` — radius over √count so a 100-activity cell is ~3× the radius
  // (not 100× the area) of a single. Multiple sports in a cell stack concentrically
  // (see `circle-sort-key` on the layer: largest drawn behind, smaller in front).
  const circlePaint = useMemo<NonNullable<CircleLayerSpecification["paint"]>>(
    () => ({
      "circle-color": colorExpression,
      "circle-opacity": 0.85,
      "circle-stroke-color": "#0b0f1a",
      "circle-stroke-width": 1,
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["sqrt", ["get", "activity_count"]],
        1,
        4,
        10,
        18,
      ],
    }),
    [colorExpression]
  );

  // Hover interactivity. The hovered/selected routes are emphasized by a separate,
  // wider highlight layer filtered to their ids — NOT via `feature-state` in
  // `line-width` (mapbox-gl GL JS doesn't support feature-state there; an invalid
  // paint expression makes the whole layer fail to render → no lines at all).
  const hoveredIdRef = useRef<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // Whether the view is in the low-zoom "density dots" tier (drives the caption).
  // Updated from the real map zoom on load + zoom; setState bails unless the
  // threshold is actually crossed, so the continuous zoom stream is cheap.
  const [dotsView, setDotsView] = useState(false);
  const syncZoomView = useCallback(() => {
    const z = mapRef.current?.getZoom();
    if (z == null) return;
    const low = z < tileMeta.lineMinZoom;
    setDotsView((prev) => (prev === low ? prev : low));
  }, [tileMeta.lineMinZoom]);

  // On load: force a resize — iOS WebKit can size the GL canvas before the
  // `fixed` map container settles, leaving a 0/stale drawing buffer (grey) until
  // something nudges it — then clear the loading state and sync the zoom tier.
  const onMapLoad = useCallback(() => {
    mapRef.current?.resize();
    setStatus("ready");
    // A genuine load clears the retry budget so a later transient failure in the
    // same session starts fresh rather than inheriting an elevated count. Same for
    // the 401-refresh budget: a full (re)mount is a clean slate.
    setRetries(0);
    authRefreshCountRef.current = 0;
    setTilesUnavailable(false);
    syncZoomView();
  }, [syncZoomView]);

  // Guard against an indefinite grey canvas: if `load` never arrives within the
  // timeout, surface the retryable error overlay. Re-armed on each (re)mount via
  // `remountKey`; cleared the moment status leaves "loading".
  useEffect(() => {
    if (status !== "loading") return;
    const t = window.setTimeout(() => setStatus("error"), MAP_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [status, remountKey]);

  // When the failure surface appears, move focus to its "Try again" button so a
  // keyboard/SR user lands on the recovery action (the alert announces, then this
  // gives them the control). `Button` doesn't forward a ref, so reach via the
  // container.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status === "error") errorRef.current?.querySelector("button")?.focus();
  }, [status]);

  // We hit-test the fat hit layer ourselves so we can rate-limit it. `interactiveLayerIds`
  // makes react-map-gl run `queryRenderedFeatures` on EVERY raw mousemove — the
  // per-event cost that janks a dense map. Instead we coalesce hover reads to one
  // query per animation frame (~60fps); clicks query on demand.
  const hoverRafRef = useRef<number | null>(null);
  // Screen point [x, y] of the latest mousemove (mapbox's `Point` type resolves to an
  // error type under type-aware lint, so we keep a plain tuple — a valid PointLike).
  const hoverPointRef = useRef<[number, number] | null>(null);

  const applyHover = useCallback(() => {
    hoverRafRef.current = null;
    const map = mapRef.current;
    const point = hoverPointRef.current;
    if (!map || !point) return;
    const f = map.queryRenderedFeatures(point, { layers: [HITAREA_LAYER_ID] })[0] as
      RouteFeature | undefined;
    const id = f?.id;
    const nextId = typeof id === "number" || typeof id === "string" ? Number(id) : null;
    map.getCanvas().style.cursor = nextId !== null ? "pointer" : "";
    if (hoveredIdRef.current === nextId) return; // only re-render on a genuine change
    hoveredIdRef.current = nextId;
    setHoveredId(nextId);
  }, []);

  const onMouseMove = useCallback(
    (e: MapMouseEvent) => {
      const p = e.point as { x: number; y: number };
      hoverPointRef.current = [p.x, p.y];
      if (hoverRafRef.current == null) {
        hoverRafRef.current = requestAnimationFrame(applyHover);
      }
    },
    [applyHover]
  );

  // Cancel any queued hover read on unmount so a pending frame can't touch a
  // torn-down map.
  useEffect(
    () => () => {
      if (hoverRafRef.current != null) cancelAnimationFrame(hoverRafRef.current);
    },
    []
  );

  const clearHover = useCallback(() => {
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = "";
    hoveredIdRef.current = null;
    setHoveredId(null);
  }, []);

  const onClick = useCallback(
    (e: MapMouseEvent) => {
      const p = e.point as { x: number; y: number };
      const f = mapRef.current?.queryRenderedFeatures([p.x, p.y], {
        layers: [HITAREA_LAYER_ID],
      })[0] as RouteFeature | undefined;
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

  // ── Camera control ──────────────────────────────────────────────────────────
  // The camera has a single imperative driver: `fitTo`, a nonce-stamped bbox
  // command from the parent (RoutesPage). RouteMap just executes it — every framing
  // decision (deep-linked activity, list-row, region select, AND the default region
  // on load) is made upstream in one place, so there's no competing-fit race or
  // suppression state to keep in sync here. `initialViewState` frames the region
  // already known at mount so first paint isn't a world view. Nonce-guarded so a
  // given request fits once, not on every re-render.
  const fittedNonceRef = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitTo || fittedNonceRef.current === fitTo.nonce) return;
    fittedNonceRef.current = fitTo.nonce;
    map.fitBounds(bboxToBounds(fitTo.bbox), {
      ...FIT_BOUNDS_OPTIONS,
      duration: fitTo.duration,
    });
  }, [fitTo, status]);

  // The hovered route + the selected route get the wider highlight layer.
  const highlightPaint = useMemo<NonNullable<LineLayerSpecification["paint"]>>(
    () => ({ "line-color": colorExpression, "line-width": HOVER_WIDTH, "line-opacity": 1 }),
    [colorExpression]
  );
  const highlightFilter = useMemo<FilterSpecification>(() => {
    const ids = [hoveredId, selected?.id ?? null].filter((id): id is number => id !== null);
    return ["in", ["get", "activity_id"], ["literal", ids]] as FilterSpecification;
  }, [hoveredId, selected]);

  return (
    // role/aria on a wrapper (react-map-gl owns the inner container div). Size with
    // w-full/h-full: Mapbox's CSS forces `position: relative` on its container, so
    // a Tailwind `absolute inset-0` would collapse to height 0 (blank grey map).
    <div className="relative w-full h-full" role="region" aria-label="Map of activity routes">
      <Map
        // Bumped by `retry` to recreate the map (fresh GL context) after a failure.
        key={remountKey}
        ref={mapRef}
        mapboxAccessToken={accessToken}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
        projection={MAP_PROJECTION}
        onLoad={onMapLoad}
        onZoom={syncZoomView}
        initialViewState={
          defaultViewport
            ? {
                bounds: bboxToBounds(defaultViewport.bbox),
                fitBoundsOptions: FIT_BOUNDS_OPTIONS,
              }
            : { longitude: 0, latitude: 20, zoom: 1 }
        }
        transformRequest={transformRequest}
        onError={handleError}
        onMouseMove={onMouseMove}
        onMouseLeave={clearHover}
        onClick={onClick}
        attributionControl={true}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Zoom/compass control, bottom-right (top-right stays clear for the insights
            toggle). Hidden on touch, where pinch-zoom covers it and the corner would
            crowd the required attribution. */}
        {!isMobile && <NavigationControl position="bottom-right" />}
        {/* Remount on reloadNonce to force a clean tile re-fetch after a 401 refresh. */}
        <Source
          key={reloadNonce}
          id={SOURCE_ID}
          type="vector"
          tiles={[tileTemplateUrl]}
          minzoom={tileMeta.minZoom}
          maxzoom={tileMeta.maxZoom}
          // Promote the MVT `activity_id` property to the feature id (per
          // source-layer) so hover/click events expose it as `feature.id` (MVT
          // features have no native id). The highlight uses a filtered layer, not
          // feature-state, so this is only for reading the id off click/hover.
          promoteId={{ [SOURCE_LAYER]: "activity_id" }}
        >
          <Layer
            id={LAYER_ID}
            type="line"
            source-layer={SOURCE_LAYER}
            minzoom={tileMeta.lineMinZoom}
            // Spread `filter` only when present — null/absent ⇒ no filter (show all).
            // (Spread, not `filter={... ?? undefined}`, for exactOptionalPropertyTypes.)
            {...(filter ? { filter } : {})}
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={linePaint}
          />
          {/* Invisible fat hit target (the only interactive layer) so taps near a
              thin route still select it. Same `filter` as the base layer, so only
              visible routes are selectable. */}
          <Layer
            id={HITAREA_LAYER_ID}
            type="line"
            source-layer={SOURCE_LAYER}
            minzoom={tileMeta.lineMinZoom}
            {...(filter ? { filter } : {})}
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={HIT_PAINT}
          />
          {/* Wider highlight for the hovered/selected route, on top of the base
              layer (filtered to those ids — no feature-state). */}
          <Layer
            id={HIGHLIGHT_LAYER_ID}
            type="line"
            source-layer={SOURCE_LAYER}
            minzoom={tileMeta.lineMinZoom}
            filter={highlightFilter}
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={highlightPaint}
          />
          {/* Low-zoom density overview: one sized dot per grid cell (the server's
              `route_points` layer), shown below the LOD switch where individual lines
              become spaghetti. Not interactive / not cross-filtered — an overview of
              the full dataset (see the caption). */}
          <Layer
            id={POINTS_LAYER_ID}
            type="circle"
            source-layer={POINTS_SOURCE_LAYER}
            maxzoom={tileMeta.lineMinZoom}
            // Stack concentric per-sport dots largest-behind: Mapbox draws ascending
            // sort-key first (at the back), so -count puts the biggest circle behind
            // and smaller ones on top — all visible.
            layout={{ "circle-sort-key": ["*", -1, ["get", "activity_count"]] }}
            paint={circlePaint}
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
      {/* Density-tier caption: the dots aggregate every activity and don't reflect
          the active filters (the cross-filter applies to the lines once zoomed in). */}
      {dotsView && (
        <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-slate-dark/80 px-3 py-1 text-center text-[0.7rem] text-slate-light backdrop-blur-sm sm:bottom-2">
          Zoomed-out density — dots show all activities; zoom in to filter
        </div>
      )}

      {/* Route tiles gave up (auth) on an otherwise-working map: keep the basemap,
          tell the user their routes couldn't load, and offer a soft retry. Only while
          `ready` — before that the full error overlay below handles it. */}
      {status === "ready" && tilesUnavailable && (
        <div
          role="status"
          // Sits above the density caption's slot (bottom-20 / sm:bottom-2) so the
          // two don't overlap when zoomed out and tiles fail at the same time.
          className="absolute bottom-28 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-dark/85 px-3 py-1 text-[0.7rem] text-slate-light backdrop-blur-sm sm:bottom-9"
        >
          <span>Routes couldn’t be loaded.</span>
          <button
            type="button"
            onClick={retryTiles}
            className="font-semibold text-accent-cyan underline underline-offset-2 hover:text-accent-magenta motion-safe:transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading spinner from mount until the map's `load` event — covers the
          post-mount, basemap/tiles-still-loading gap that previously read as a bare
          grey canvas (notably the slow first load on mobile). */}
      {status === "loading" && <MapLoadingState />}

      {/* Failure surface — replaces the indefinite silent grey when the basemap/style/
          WebGL can't come up (e.g. WebGL unavailable on iOS, a stalled style fetch).
          Retryable until MAX_RETRIES, then terminal (no button) so it can't loop
          forever on a browser that simply can't render the map. The internal-401 tile
          recovery escalates here only on a not-yet-ready map (after the refresh cap);
          on an already-rendered map it shows the dismissible notice above instead. */}
      {status === "error" && (
        <div
          ref={errorRef}
          className="absolute inset-0 grid place-items-center bg-bg-body/90 px-6"
          role="alert"
        >
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            {retries < MAX_RETRIES ? (
              <>
                <p className="text-sm text-slate-light">
                  The map couldn’t be displayed. This can happen if your browser can’t render maps,
                  or the connection stalled.
                </p>
                <Button variant="outline" size="sm" onClick={retry}>
                  Try again
                </Button>
              </>
            ) : (
              <p className="text-sm text-slate-light">
                The map still couldn’t be displayed. Your browser may not support maps, or the
                connection is unavailable — please try again later.
              </p>
            )}
          </div>
        </div>
      )}
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
        {selected.sportLabel && (
          <div className="flex justify-between gap-4">
            <dt>Sport</dt>
            <dd className="text-body-text">{selected.sportLabel}</dd>
          </div>
        )}
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
            <dd className="tabular-nums text-body-text">
              {formatActivityDate(selected.date, { year: true })}
            </dd>
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
