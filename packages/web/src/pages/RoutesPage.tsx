import { Suspense, lazy, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { PageLayout } from "../components/layout/PageLayout";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../contexts/ThemeContext";
import { useRouteRegions } from "../hooks/useRouteRegions";
import { useSportConfig } from "../hooks/useSportConfig";
import { useAuthTokenRef } from "../hooks/useAuthTokenRef";
import { getConfig } from "../lib/config";
import { buildTileTemplateUrl } from "../api/map";
import { buildSportColorExpression } from "../utils/routeMapStyle";

// Lazy-loaded so `mapbox-gl` (and its CSS) ship in their own async chunk and
// never bloat the main bundle or any non-map page.
const RouteMap = lazy(() => import("../components/routes/RouteMap"));

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
  const { getToken, token, ready: tokenReady, refresh: refreshAuthToken } = useAuthTokenRef();

  const colorExpression = useMemo(
    () => buildSportColorExpression(sportConfig, isDark),
    [sportConfig, isDark]
  );

  const mapConfig = useMemo(() => {
    if (!mapboxToken || !apiGatewayUrl || typeof window === "undefined") return null;
    return {
      tileTemplateUrl: buildTileTemplateUrl(apiGatewayUrl, window.location.origin),
      apiBaseUrl: `${apiGatewayUrl}/v1`,
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

  // Gate on a resolved token, not just `tokenReady` — mounting the map before a
  // token exists would 401 every tile (mapbox doesn't retry errored tiles).
  if (authLoading || regionsLoading || !tokenReady || !token) {
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
              defaultViewport={defaultViewport}
              isDark={isDark}
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
