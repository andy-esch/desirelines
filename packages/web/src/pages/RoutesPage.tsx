import { Suspense, lazy, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
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
import type { SportOption } from "../components/routes/MapFilterControls";

// Lazy-loaded so `mapbox-gl` (and its CSS) ship in their own async chunk and
// never bloat the main bundle or any non-map page.
const RouteMap = lazy(() => import("../components/routes/RouteMap"));
const MapFilterDrawer = lazy(() => import("../components/routes/MapFilterDrawer"));
const MapFilterControls = lazy(() => import("../components/routes/MapFilterControls"));

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

  const { defaultViewport, isLoading: regionsLoading, error } = useRouteRegions();
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

  // Throttle ONLY the map's filter edge — the summary/controls react to the raw
  // filter state instantly, but a dragged distance slider doesn't recompile the
  // Mapbox filter every frame (see the design-spec review addendum).
  const throttledMapFilter = useThrottledValue(routeFilters.mapFilter, 120);

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
  // avoids an infinite "Loading map..." hang when getIdToken() returns undefined.
  if (authLoading || regionsLoading || !tokenReady) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-slate-light" role="status">
            Loading map...
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
          <Suspense fallback={null}>
            <RouteMap
              accessToken={mapboxToken}
              tileTemplateUrl={mapConfig.tileTemplateUrl}
              apiBaseUrl={mapConfig.apiBaseUrl}
              getAuthToken={getToken}
              refreshAuthToken={refreshAuthToken}
              colorExpression={colorExpression}
              filter={throttledMapFilter}
              defaultViewport={defaultViewport}
              isDark={isDark}
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
                disabled={datasetLoading || activities.length === 0}
              />
            </MapFilterDrawer>
          </Suspense>

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
