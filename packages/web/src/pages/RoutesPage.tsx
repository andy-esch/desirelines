import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { FilterSpecification } from "mapbox-gl";
import { PageLayout } from "../components/layout/PageLayout";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../contexts/ThemeContext";
import { useRouteRegions } from "../hooks/useRouteRegions";
import { useSportConfig } from "../hooks/useSportConfig";
import { useAuthTokenRef } from "../hooks/useAuthTokenRef";
import { useMapDataset } from "../hooks/useMapDataset";
import { useRouteFilters } from "../hooks/useRouteFilters";
import { useThrottledValue } from "../hooks/useThrottledValue";
import { useUserConfig } from "../hooks/useUserConfig";
import { getUserSettings } from "../utils/units";
import { getConfig } from "../lib/config";
import { buildTileTemplateUrl, buildApiBaseUrl } from "../api/map";
import { buildSportColorExpression } from "../utils/routeMapStyle";
import { DEFAULT_SPORT_COLOR } from "../utils/sportConfig";
import { getSpectrumColor } from "../utils/chartColors";
import MapLoadingState from "../components/routes/MapLoadingState";
import type { SportOption } from "../components/routes/MapFilterControls";
import type { SelectedRoute } from "../components/routes/RouteMap";
import type { MapActivity } from "../api/map";

// Lazy-loaded so `mapbox-gl` (and its CSS) ship in their own async chunk and
// never bloat the main bundle or any non-map page.
const RouteMap = lazy(() => import("../components/routes/RouteMap"));
const MapFilterDrawer = lazy(() => import("../components/routes/MapFilterDrawer"));
const MapFilterControls = lazy(() => import("../components/routes/MapFilterControls"));
const MapActivityList = lazy(() => import("../components/routes/MapActivityList"));
const MapTimeRangeFilter = lazy(() => import("../components/routes/MapTimeRangeFilter"));
const MapInsightsDrawer = lazy(() => import("../components/routes/MapInsightsDrawer"));
const SportBreakdownChart = lazy(() => import("../components/routes/SportBreakdownChart"));
const WeeklyVolumeChart = lazy(() => import("../components/routes/WeeklyVolumeChart"));
const CumulativeDistanceChart = lazy(() => import("../components/routes/CumulativeDistanceChart"));
const DistanceHistogramChart = lazy(() => import("../components/routes/DistanceHistogramChart"));
const RegionBreakdownChart = lazy(() => import("../components/routes/RegionBreakdownChart"));

/** Must match the rendered header height (see also sidebar top offset in tailwind.css) */
const HEADER_HEIGHT = 48;

function StatusMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex grow items-center justify-center">{children}</div>;
}

export default function RoutesPage() {
  const { user, loading: authLoading } = useAuth();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const config = getConfig();
  const mapboxToken = config.mapboxToken;
  const apiGatewayUrl = config.apiGatewayUrl;

  const { regions, defaultViewport, isLoading: regionsLoading, error } = useRouteRegions();
  const { sportConfig } = useSportConfig();
  const { getToken, ready: tokenReady, refresh: refreshAuthToken } = useAuthTokenRef();

  // Cross-filter dataset + state. Loaded independently of the map so a slow
  // dataset fetch never blocks the basemap/tiles; the drawer shows its own
  // loading state. Filtering is entirely client-side (see useRouteFilters).
  const { activities, isLoading: datasetLoading, error: datasetError } = useMapDataset();
  const routeFilters = useRouteFilters(activities);
  const { data: prefs } = useUserConfig("preferences");
  const { distanceUnit, elevationUnit } = getUserSettings(prefs);
  const [drawerOpen, setDrawerOpen] = useState(true);
  // Insights (charts) live in a RHS drawer, auto-hidden by default (open via its
  // edge handle) so the map stays unobstructed.
  const [insightsOpen, setInsightsOpen] = useState(false);

  // App-category sports present in the data, in a stable order. Each gets a NEON
  // spectrum color by its position — the SAME full-brightness `getSpectrumColor`
  // the dashboard sparklines use (Magenta→Cyan→Green→Yellow→Orange), in BOTH
  // themes, so the map lines/chips match the dashboard's brightness exactly. (The
  // glow underlay carries legibility on the basemap, so no darkening for light.)
  const orderedSports = useMemo(
    () => [...new Set(activities.map((a) => a.sport))].sort(),
    [activities]
  );
  const sportColors = useMemo(() => {
    const total = orderedSports.length;
    const map: Record<string, string> = {};
    orderedSports.forEach((sport, i) => {
      map[sport] = getSpectrumColor(i, total);
    });
    return map;
  }, [orderedSports]);

  const sportOptions = useMemo<SportOption[]>(
    () =>
      orderedSports.map((sport) => ({
        value: sport,
        label: sportConfig?.sportCategories?.[sport]?.displayName ?? sport,
        color: sportColors[sport] ?? DEFAULT_SPORT_COLOR,
      })),
    [orderedSports, sportConfig, sportColors]
  );
  // sport → display label, for the insights breakdown (over the filtered subset).
  const sportLabels = useMemo<Record<string, string>>(
    () => Object.fromEntries(sportOptions.map((o) => [o.value, o.label])),
    [sportOptions]
  );
  // region id → name, for the region-breakdown chart labels.
  const regionNames = useMemo<Record<number, string>>(
    () => Object.fromEntries(regions.map((r) => [r.regionId, r.name])),
    [regions]
  );

  // Throttle ONLY the map's filter edge — the summary/controls react to the raw
  // filter state instantly, but a dragged distance slider doesn't recompile the
  // Mapbox filter every frame (see the design-spec review addendum).
  const throttledMapFilter = useThrottledValue(routeFilters.mapFilter, 120);

  // Deep-link focus (the activity lists' "View on map" → /routes?activity=<id>).
  // `strict: false` reads the search without coupling to the exact route id (works
  // under the test router too); the `/routes` route's validateSearch coerces it.
  const search = useSearch({ strict: false });
  const navigate = useNavigate({ from: "/routes" });
  const rawActivity: unknown = search.activity;
  const focusId =
    typeof rawActivity === "number" && Number.isFinite(rawActivity) ? rawActivity : null;

  // When focused, the map shows ONLY that route (override the cross-filter); the
  // effect below opens its popup + frames it. Otherwise the normal throttled filter.
  const mapFilter = useMemo<FilterSpecification | null>(
    () =>
      focusId != null
        ? (["in", ["get", "activity_id"], ["literal", [focusId]]] as FilterSpecification)
        : (throttledMapFilter ?? null),
    [focusId, throttledMapFilter]
  );

  // Lookup by id for the map's click popover (supplies movingTime, which the MVT
  // tile doesn't carry). Built over the full dataset, keyed by activityId.
  const getActivity = useMemo(() => {
    const byId = new Map(activities.map((a) => [a.activityId, a]));
    return (id: number) => byId.get(id);
  }, [activities]);

  // Selected route — the single source of truth shared by the map popover and the
  // activity list. A map click sets it with a click point; a list-row click sets it
  // from the route's bbox centroid (and frames the route, see requestFit).
  const [selected, setSelected] = useState<SelectedRoute | null>(null);
  // Imperative "frame this bbox" requests (list-row + region select) — a bumped
  // nonce so re-selecting the same target re-fits.
  const [fitTo, setFitTo] = useState<{
    bbox: [number, number, number, number];
    nonce: number;
  } | null>(null);
  const fitNonceRef = useRef(0);
  const requestFit = useCallback((bbox?: number[]) => {
    if (bbox && bbox.length === 4) {
      setFitTo({ bbox: bbox as [number, number, number, number], nonce: ++fitNonceRef.current });
    }
  }, []);

  // Apply the deep-link focus once the dataset has the activity: open its popup
  // (anchored at the route's bbox center, since there's no click point) and frame
  // it. Guarded by a ref so it applies once per focus id, not every render.
  const focusAppliedRef = useRef<number | null>(null);
  useEffect(() => {
    if (focusId == null) {
      focusAppliedRef.current = null;
      return;
    }
    if (focusAppliedRef.current === focusId) return;
    const a = getActivity(focusId);
    if (!a) return; // dataset still loading, or the id isn't in the user's map set
    focusAppliedRef.current = focusId;
    const bbox = a.bbox;
    const center =
      bbox && bbox.length === 4
        ? { lng: (bbox[0]! + bbox[2]!) / 2, lat: (bbox[1]! + bbox[3]!) / 2 }
        : {};
    // One-shot sync of the URL focus param into selection state (ref-guarded, so it
    // can't cascade) — the popup/fit depend on the dataset, which may load after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected({
      id: a.activityId,
      name: a.name,
      distanceMeters: a.distanceMeters,
      date: a.startDateLocal.slice(0, 10),
      ...center,
    });
    requestFit(bbox);
  }, [focusId, getActivity, requestFit]);

  // Leave focus: clear the popup + drop the ?activity= param (restores the full map).
  // `/routes` carries no other search params, so replacing search with {} is enough.
  const exitFocus = useCallback(() => {
    setSelected(null);
    void navigate({ search: {} });
  }, [navigate]);

  const onSelectFromList = useCallback(
    (a: MapActivity) => {
      const bbox = a.bbox;
      const center =
        bbox && bbox.length === 4
          ? { lng: (bbox[0]! + bbox[2]!) / 2, lat: (bbox[1]! + bbox[3]!) / 2 }
          : {};
      setSelected({
        id: a.activityId,
        name: a.name,
        distanceMeters: a.distanceMeters,
        date: a.startDateLocal.slice(0, 10),
        ...center,
      });
      requestFit(bbox);
    },
    [requestFit]
  );

  // Region select → filter to that region + frame it (uses the region's name/bbox
  // from /map/regions). `null` = all regions.
  const onSelectRegion = useCallback(
    (regionId: number | null) => {
      routeFilters.setRegionId(regionId);
      if (regionId !== null) requestFit(regions.find((r) => r.regionId === regionId)?.bbox);
    },
    [routeFilters, regions, requestFit]
  );

  // Drop the selection if the active filter no longer includes it — otherwise a
  // lone highlighted line + open popup linger for a route not in the current set.
  // (Adjusting state during render; converges since clearing makes the test false.)
  const filteredIdSet = useMemo(
    () => new Set(routeFilters.filteredIds),
    [routeFilters.filteredIds]
  );
  if (selected !== null && !filteredIdSet.has(selected.id)) {
    setSelected(null);
  }

  const colorExpression = useMemo(
    () => buildSportColorExpression(sportConfig, sportColors, DEFAULT_SPORT_COLOR),
    [sportConfig, sportColors]
  );

  const mapConfig = useMemo(() => {
    if (!mapboxToken || !apiGatewayUrl || typeof window === "undefined") return null;
    return {
      tileTemplateUrl: buildTileTemplateUrl(apiGatewayUrl, window.location.origin),
      // Absolute so Mapbox's transformRequest correctly classifies internal tile
      // requests (and attaches the auth header) when the gateway is a same-origin
      // path like "/api". See buildApiBaseUrl.
      apiBaseUrl: buildApiBaseUrl(apiGatewayUrl, window.location.origin),
    };
  }, [mapboxToken, apiGatewayUrl]);

  // Unauthenticated → keep the existing sign-in prompt (demo mode is unchanged:
  // /routes has always been auth-gated; demo users never reach it).
  if (!authLoading && !user) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-slate-light">
            <Link to="/" className="text-accent-cyan no-underline">
              Sign in
            </Link>{" "}
            to view your route map.
          </p>
        </StatusMessage>
      </PageLayout>
    );
  }

  // Missing/absent Mapbox token (or gateway) → graceful degradation, no crash.
  if (!mapboxToken || !mapConfig) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-slate-light text-sm" role="status">
            Map is unavailable right now.
          </p>
        </StatusMessage>
      </PageLayout>
    );
  }

  // Gate only on auth having *settled* (tokenReady), not on a token actually
  // being present. In the normal signed-in case the token is already in hand by
  // then, so we still avoid a token-less first tile fetch. If the token fetch
  // failed or raced, we still mount the map — the basemap (Mapbox-hosted) renders
  // and the 401-recovery in RouteMap re-requests tiles once a token lands. This
  // avoids an infinite "Loading map…" hang when getIdToken() returns undefined.
  if (authLoading || regionsLoading || !tokenReady) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-slate-light" role="status">
            Loading map…
          </p>
        </StatusMessage>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-danger" role="alert">
            Failed to load map. Please try again later.
          </p>
        </StatusMessage>
      </PageLayout>
    );
  }

  return (
    <PageLayout background="routes">
      <div className="fixed inset-x-0 bottom-0 bg-bg-body" style={{ top: HEADER_HEIGHT }}>
        <div className="relative w-full h-full">
          <Suspense fallback={<MapLoadingState />}>
            <RouteMap
              accessToken={mapboxToken}
              tileTemplateUrl={mapConfig.tileTemplateUrl}
              apiBaseUrl={mapConfig.apiBaseUrl}
              getAuthToken={getToken}
              refreshAuthToken={refreshAuthToken}
              colorExpression={colorExpression}
              filter={mapFilter}
              defaultViewport={defaultViewport}
              isDark={isDark}
              distanceUnit={distanceUnit}
              getActivity={getActivity}
              selected={selected}
              onSelect={setSelected}
              fitTo={fitTo}
            />
          </Suspense>

          {/* Non-modal filter/insights drawer over the live map (lazy with the map
              chunk). Filter controls mount in its children; charts + activity list
              slot in next. */}
          <Suspense fallback={null}>
            <MapFilterDrawer
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              totals={routeFilters.totals}
              totalCount={activities.length}
              activeFilterCount={routeFilters.activeFilterCount}
              onReset={routeFilters.reset}
              onShowAll={routeFilters.showAll}
              distanceUnit={distanceUnit}
              elevationUnit={elevationUnit}
              isDark={isDark}
              isLoading={datasetLoading}
              error={datasetError}
            >
              <MapFilterControls
                filters={routeFilters.filters}
                sportOptions={sportOptions}
                distanceDomain={routeFilters.distanceDomain}
                dateDomain={routeFilters.dateDomain}
                distanceUnit={distanceUnit}
                onSportsChange={routeFilters.setSports}
                onDistanceChange={routeFilters.setDistanceRange}
                onSelectYear={routeFilters.selectYear}
                onSelectAllTime={() => routeFilters.setDateRange(routeFilters.dateDomain)}
                regions={regions}
                selectedRegionId={routeFilters.filters.regionId}
                onSelectRegion={onSelectRegion}
                disabled={datasetLoading || activities.length === 0}
              />
              <div className="border-t border-border/60">
                <MapActivityList
                  activities={routeFilters.filteredActivities}
                  sportColors={sportColors}
                  distanceUnit={distanceUnit}
                  selectedId={selected?.id ?? null}
                  onSelect={onSelectFromList}
                />
              </div>
              <div className="border-t border-border/60">
                <MapTimeRangeFilter
                  dateDomain={routeFilters.dateDomain}
                  dateRange={routeFilters.filters.dateRange}
                  onChange={routeFilters.setDateRange}
                  disabled={datasetLoading || activities.length === 0}
                />
              </div>
            </MapFilterDrawer>
          </Suspense>

          {/* Right-hand insights drawer — cross-filtered charts; auto-hidden, opens
              via its edge handle. Only mounted once there's data to summarize. */}
          {activities.length > 0 && (
            <Suspense fallback={null}>
              <MapInsightsDrawer open={insightsOpen} onOpenChange={setInsightsOpen} isDark={isDark}>
                <SportBreakdownChart
                  activities={routeFilters.filteredActivities}
                  sportColors={sportColors}
                  sportLabels={sportLabels}
                  distanceUnit={distanceUnit}
                  selectedSports={routeFilters.filters.sports}
                  onToggleSport={routeFilters.toggleSport}
                />
                <div className="border-t border-border/60">
                  <WeeklyVolumeChart
                    activities={routeFilters.filteredActivities}
                    distanceUnit={distanceUnit}
                  />
                </div>
                <div className="border-t border-border/60">
                  <CumulativeDistanceChart
                    activities={routeFilters.filteredActivities}
                    distanceUnit={distanceUnit}
                  />
                </div>
                <div className="border-t border-border/60">
                  <DistanceHistogramChart
                    activities={routeFilters.filteredActivities}
                    distanceUnit={distanceUnit}
                    onSelectRange={routeFilters.setDistanceRange}
                  />
                </div>
                <div className="border-t border-border/60">
                  <RegionBreakdownChart
                    activities={routeFilters.filteredActivities}
                    regionNames={regionNames}
                    distanceUnit={distanceUnit}
                    selectedRegionId={routeFilters.filters.regionId}
                    onSelectRegion={onSelectRegion}
                  />
                </div>
              </MapInsightsDrawer>
            </Suspense>
          )}

          {/* Deep-link focus banner: the map is pinned to one activity. Offers the
              way back to the full map (also clears the ?activity= param). */}
          {focusId != null && (
            <div className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-dark/85 px-3 py-1 text-xs text-slate-light backdrop-blur-sm">
              <span>
                {datasetLoading
                  ? "Loading activity…"
                  : getActivity(focusId)
                    ? "Showing one activity"
                    : "That activity isn't on your map"}
              </span>
              <button
                type="button"
                onClick={exitFocus}
                className="font-medium text-accent-cyan hover:underline"
              >
                Show all
              </button>
            </div>
          )}

          {/* No geo-bearing activities → map falls back to a world view; hint why it's empty. */}
          {!defaultViewport && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-slate-light text-sm bg-bg-body/70 rounded px-3 py-1" role="status">
                No routes yet. Go record some activities!
              </p>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
