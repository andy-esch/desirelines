import { useMemo, useCallback, useRef } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useRouteData } from "../hooks/useRouteData";
import RouteCanvas, { type RouteCanvasHandle } from "../components/routes/RouteCanvas";
import RouteLegend from "../components/routes/RouteLegend";
import { PageLayout } from "../components/layout/PageLayout";
import { useAuth } from "../hooks/useAuth";
import { useUserConfig } from "../hooks/useUserConfig";
import { getUserSettings } from "../utils/units";
import { ROUTES_LIMIT } from "../api/routes";
import { Link } from "@tanstack/react-router";

function StatusMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex grow items-center justify-center">{children}</div>;
}

/** Parse comma-separated string into a Set. Returns null if absent (all enabled), empty Set if empty string. */
function parseCommaSeparated<T>(value: string | undefined, parse: (s: string) => T): Set<T> | null {
  if (value === undefined) return null;
  if (value === "") return new Set<T>();
  return new Set(
    value
      .split(",")
      .filter((s) => s !== "")
      .map(parse)
  );
}

/** Extract year from ISO date string (e.g. "2024-01-15") without Date constructor timezone issues */
function getYearFromDate(dateStr: string): number {
  return parseInt(dateStr, 10);
}

export default function RoutesPage() {
  const { user, loading: authLoading } = useAuth();
  const { routes, isLoading, error } = useRouteData();
  const search = useSearch({ from: "/routes" });
  const navigate = useNavigate();
  const canvasRef = useRef<RouteCanvasHandle>(null);

  const { data: preferences } = useUserConfig("preferences");
  const userSettings = getUserSettings(preferences);

  // Derive available sports and years from all routes
  const { sportInfos, allYears } = useMemo(() => {
    const sportCounts = new Map<string, number>();
    const yearSet = new Set<number>();

    for (const route of routes) {
      sportCounts.set(route.sport, (sportCounts.get(route.sport) ?? 0) + 1);
      const year = getYearFromDate(route.date);
      if (!isNaN(year)) yearSet.add(year);
    }

    const sportInfos = Array.from(sportCounts.entries())
      .map(([sport, count]) => ({ sport, count }))
      .sort((a, b) => b.count - a.count);

    const allYears = Array.from(yearSet).sort((a, b) => b - a);

    return { sportInfos, allYears };
  }, [routes]);

  // Parse URL params into filter sets (null = "all enabled")
  const urlSports = useMemo(() => parseCommaSeparated(search.sports, (s) => s), [search.sports]);
  const urlYears = useMemo(() => parseCommaSeparated(search.years, Number), [search.years]);

  // Effective enabled sets: if no URL param, everything is enabled
  const enabledSports = useMemo(
    () => urlSports ?? new Set(sportInfos.map((s) => s.sport)),
    [urlSports, sportInfos]
  );
  const enabledYears = useMemo(() => urlYears ?? new Set(allYears), [urlYears, allYears]);

  // Filter routes
  const filteredRoutes = useMemo(() => {
    return routes.filter((route) => {
      if (!enabledSports.has(route.sport)) return false;
      const year = getYearFromDate(route.date);
      if (!enabledYears.has(year)) return false;
      return true;
    });
  }, [routes, enabledSports, enabledYears]);

  // Filtered sport counts (for legend display)
  const filteredSportInfos = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of filteredRoutes) {
      counts.set(route.sport, (counts.get(route.sport) ?? 0) + 1);
    }
    return sportInfos.map((s) => ({
      sport: s.sport,
      count: counts.get(s.sport) ?? 0,
    }));
  }, [filteredRoutes, sportInfos]);

  // Total distance of filtered routes
  const totalDistanceMeters = useMemo(
    () => filteredRoutes.reduce((sum, r) => sum + r.distance, 0),
    [filteredRoutes]
  );

  // URL update helpers
  const updateSearch = useCallback(
    (sports: Set<string>, years: Set<number>) => {
      const allSportsStr = sportInfos.map((s) => s.sport);
      const allSportsEnabled =
        sports.size === allSportsStr.length && allSportsStr.every((s) => sports.has(s));
      const allYearsEnabled = years.size === allYears.length && allYears.every((y) => years.has(y));

      navigate({
        to: "/routes",
        search: {
          sports: allSportsEnabled ? undefined : Array.from(sports).join(","),
          years: allYearsEnabled ? undefined : Array.from(years).join(","),
        },
        replace: true,
      });
    },
    [navigate, sportInfos, allYears]
  );

  const handleToggleSport = useCallback(
    (sport: string) => {
      const next = new Set(enabledSports);
      if (next.has(sport)) {
        next.delete(sport);
      } else {
        next.add(sport);
      }
      updateSearch(next, enabledYears);
    },
    [enabledSports, enabledYears, updateSearch]
  );

  const handleToggleYear = useCallback(
    (year: number) => {
      const next = new Set(enabledYears);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      updateSearch(enabledSports, next);
    },
    [enabledSports, enabledYears, updateSearch]
  );

  const handleToggleAllSports = useCallback(
    (enabled: boolean) => {
      const next = enabled ? new Set(sportInfos.map((s) => s.sport)) : new Set<string>();
      updateSearch(next, enabledYears);
    },
    [sportInfos, enabledYears, updateSearch]
  );

  const handleToggleAllYears = useCallback(
    (enabled: boolean) => {
      const next = enabled ? new Set(allYears) : new Set<number>();
      updateSearch(enabledSports, next);
    },
    [allYears, enabledSports, updateSearch]
  );

  const handleSaveImage = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;

    const activeSports = Array.from(enabledSports).join("-") || "all";
    const activeYears =
      enabledYears.size === allYears.length
        ? "all-years"
        : Array.from(enabledYears)
            .sort((a, b) => a - b)
            .join("-");
    const filename = `desirelines-${activeSports}-${activeYears}.png`;

    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [enabledSports, enabledYears, allYears]);

  // Status states
  let statusContent: React.ReactNode = null;

  if (!authLoading && !user) {
    statusContent = (
      <p className="text-slate-light">
        <Link to="/" className="text-accent-cyan no-underline">
          Sign in
        </Link>{" "}
        to view your route art.
      </p>
    );
  } else if (isLoading) {
    statusContent = <p className="text-slate-light">Loading routes...</p>;
  } else if (error) {
    statusContent = <p className="text-danger">Failed to load routes. Please try again later.</p>;
  } else if (routes.length === 0) {
    statusContent = <p className="text-slate-light">No routes yet. Go record some activities!</p>;
  }

  if (statusContent) {
    return (
      <PageLayout background="routes">
        <StatusMessage>{statusContent}</StatusMessage>
      </PageLayout>
    );
  }

  const noMatchingRoutes = filteredRoutes.length === 0 && routes.length > 0;

  return (
    <PageLayout background="routes">
      <div className="fixed inset-x-0 bottom-0 bg-bg-body" style={{ top: 48 }}>
        <div className="relative w-full h-full">
          {noMatchingRoutes ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-light text-sm">No routes match your filters</p>
            </div>
          ) : (
            <RouteCanvas ref={canvasRef} routes={filteredRoutes} />
          )}

          <RouteLegend
            sports={filteredSportInfos}
            years={allYears}
            enabledSports={enabledSports}
            enabledYears={enabledYears}
            shownCount={filteredRoutes.length}
            shownDistanceMeters={totalDistanceMeters}
            atLimit={routes.length >= ROUTES_LIMIT}
            limit={ROUTES_LIMIT}
            distanceUnit={userSettings.distanceUnit}
            onToggleSport={handleToggleSport}
            onToggleYear={handleToggleYear}
            onToggleAllSports={handleToggleAllSports}
            onToggleAllYears={handleToggleAllYears}
            onSaveImage={handleSaveImage}
          />
        </div>
      </div>
    </PageLayout>
  );
}
