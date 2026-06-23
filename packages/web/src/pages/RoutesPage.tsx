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
import { useUserConfig } from "../hooks/useUserConfig";
import { getUserSettings } from "../utils/units";
import { getConfig } from "../lib/config";
import { buildTileTemplateUrl, buildApiBaseUrl } from "../api/map";
import { buildSportColorExpression } from "../utils/routeMapStyle";

// Lazy-loaded so `mapbox-gl` (and its CSS) ship in their own async chunk and
// never bloat the main bundle or any non-map page.
const RouteMap = lazy(() => import("../components/routes/RouteMap"));
const MapFilterDrawer = lazy(() => import("../components/routes/MapFilterDrawer"));

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

  const colorExpression = useMemo(
    () => buildSportColorExpression(sportConfig, isDark),
    [sportConfig, isDark]
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
              filter={routeFilters.mapFilter}
              defaultViewport={defaultViewport}
              isDark={isDark}
            />
          </Suspense>

          {/* Non-modal filter/insights drawer over the live map (lazy with the map
              chunk). Step 1 ships the shell + live cross-filter summary; controls,
              charts, and the activity list slot into it next. */}
          <Suspense fallback={null}>
            <MapFilterDrawer
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              totals={routeFilters.totals}
              totalCount={activities.length}
              activeFilterCount={routeFilters.activeFilterCount}
              onReset={routeFilters.reset}
              distanceUnit={distanceUnit}
              elevationUnit={elevationUnit}
              isLoading={datasetLoading}
              error={datasetError}
            />
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
