import { useMemo, useCallback, useRef } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useRouteData } from "../hooks/useRouteData";
import RouteCanvas, {
  type RouteCanvasHandle,
  buildSportColorMap,
} from "../components/routes/RouteCanvas";
import RouteLegend from "../components/routes/RouteLegend";
import { PageLayout } from "../components/layout/PageLayout";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../contexts/ThemeContext";
import { useUserConfig } from "../hooks/useUserConfig";
import {
  getUserSettings,
  getDistanceLabel,
  convertDistance,
  MILES_TO_METERS,
  KM_TO_METERS,
} from "../utils/units";
import type { DistanceUnit } from "../utils/units";
import { ROUTES_LIMIT, type RouteRing } from "../api/routes";
import { Link } from "@tanstack/react-router";

/** Must match the rendered header height (see also sidebar top offset in tailwind.css) */
const HEADER_HEIGHT = 48;

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

/** "Nice" step sizes in display units, ordered smallest to largest. */
const NICE_STEPS_MI = [0.5, 1, 2, 5, 10, 15, 25, 50];
const NICE_STEPS_KM = [1, 2, 5, 10, 20, 30, 50, 100];
const RING_COUNT = 3;

/**
 * Compute ring intervals that fit the data extent.
 * Picks the smallest "nice" step where RING_COUNT rings cover the max reach,
 * estimated as half the longest route distance (out-and-back heuristic).
 */
function computeRingMeters(maxRouteDistanceMeters: number, unit: DistanceUnit): number[] {
  // Estimate max reach from center: half the longest route (out-and-back assumption)
  const maxReachMeters = maxRouteDistanceMeters / 2;
  const maxReachDisplay = convertDistance(maxReachMeters, unit);

  const niceSteps = unit === "miles" ? NICE_STEPS_MI : NICE_STEPS_KM;
  const toMeters = unit === "miles" ? MILES_TO_METERS : KM_TO_METERS;

  // Find smallest step where RING_COUNT * step >= maxReach
  const step = niceSteps.find((s) => s * RING_COUNT >= maxReachDisplay) ?? niceSteps.at(-1) ?? 1;

  return Array.from({ length: RING_COUNT }, (_, i) => Math.round((i + 1) * step * toMeters));
}

/** Format a ring radius for display: e.g. "10 mi" or "20 km" */
function formatRingLabel(radiusMeters: number, unit: DistanceUnit): string {
  const value = convertDistance(radiusMeters, unit);
  return `${Math.round(value)} ${getDistanceLabel(unit)}`;
}

const RING_SEGMENTS = 64;
/** Approximate meters per degree (used to place rings in the same degree-offset space as routes) */
const METERS_PER_DEGREE = 111_320;

/** Generate circle coordinates centered at (0, 0) in degree-offset space. */
function generateCircleCoords(radiusMeters: number): [number, number][] {
  const radiusDeg = radiusMeters / METERS_PER_DEGREE;
  const coords: [number, number][] = [];
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const angle = (2 * Math.PI * i) / RING_SEGMENTS;
    coords.push([radiusDeg * Math.cos(angle), radiusDeg * Math.sin(angle)]);
  }
  return coords;
}

/** Build rings as client-side circles. For the empty state, uses default radii. */
function buildRings(ringMeters: number[]): RouteRing[] {
  return ringMeters.map((radiusMeters) => ({
    radiusMeters,
    coords: generateCircleCoords(radiusMeters),
  }));
}

/** Default ring radii for the empty-routes welcome state. */
function defaultRingMeters(unit: DistanceUnit): number[] {
  const step = unit === "miles" ? 5 * MILES_TO_METERS : 10 * KM_TO_METERS;
  return [1, 2, 3].map((n) => Math.round(n * step));
}

export default function RoutesPage() {
  const { user, loading: authLoading } = useAuth();
  const search = useSearch({ from: "/routes" });
  const navigate = useNavigate();
  const canvasRef = useRef<RouteCanvasHandle>(null);

  const { data: preferences } = useUserConfig("preferences");
  const userSettings = getUserSettings(preferences);
  const { resolvedTheme } = useTheme();

  // Ring state: "on" in URL means rings are visible
  const showRings = search.rings === "on";

  const { routes, isLoading, error } = useRouteData();

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

  // Build color map: assign maximally-contrasting colors based on sport count order
  const sportColors = useMemo(
    () =>
      buildSportColorMap(
        sportInfos.map((s) => s.sport),
        resolvedTheme === "dark"
      ),
    [sportInfos, resolvedTheme]
  );

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

  // Compute rings client-side, scaled to the data extent
  const maxRouteDistance = useMemo(
    () => routes.reduce((max, r) => Math.max(max, r.distance), 0),
    [routes]
  );
  const rings = useMemo(() => {
    if (routes.length === 0) return buildRings(defaultRingMeters(userSettings.distanceUnit));
    return buildRings(computeRingMeters(maxRouteDistance, userSettings.distanceUnit));
  }, [routes.length, maxRouteDistance, userSettings.distanceUnit]);

  // URL update helpers
  const updateSearch = useCallback(
    (sports: Set<string>, years: Set<number>, ringsOn?: boolean) => {
      const allSportsEnabled = sports.size === sportInfos.length;
      const allYearsEnabled = years.size === allYears.length && allYears.every((y) => years.has(y));
      const ringsValue = ringsOn !== undefined ? ringsOn : showRings;

      void navigate({
        to: "/routes",
        search: {
          sports: allSportsEnabled ? undefined : Array.from(sports).join(","),
          years: allYearsEnabled ? undefined : Array.from(years).join(","),
          rings: ringsValue ? "on" : undefined,
        },
        replace: true,
      });
    },
    [navigate, sportInfos, allYears, showRings]
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

  const ringLabelFormatter = useCallback(
    (radiusMeters: number) => formatRingLabel(radiusMeters, userSettings.distanceUnit),
    [userSettings.distanceUnit]
  );

  const handleToggleRings = useCallback(() => {
    updateSearch(enabledSports, enabledYears, !showRings);
  }, [enabledSports, enabledYears, showRings, updateSearch]);

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

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [enabledSports, enabledYears, allYears]);

  // Early-return status states (auth, loading, error)
  if (!authLoading && !user) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-slate-light">
            <Link to="/" className="text-accent-cyan no-underline">
              Sign in
            </Link>{" "}
            to view your route art.
          </p>
        </StatusMessage>
      </PageLayout>
    );
  }

  if (isLoading) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-slate-light">Loading routes...</p>
        </StatusMessage>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-danger">Failed to load routes. Please try again later.</p>
        </StatusMessage>
      </PageLayout>
    );
  }

  const isEmpty = routes.length === 0;
  const noMatchingRoutes = !isEmpty && filteredRoutes.length === 0;

  // Rings: always shown for empty state, toggled for routes
  const displayRings = isEmpty || showRings ? rings : undefined;

  return (
    <PageLayout background="routes">
      <div className="fixed inset-x-0 bottom-0 bg-bg-body" style={{ top: HEADER_HEIGHT }}>
        <div className="relative w-full h-full">
          {noMatchingRoutes ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-light text-sm">No routes match your filters</p>
            </div>
          ) : (
            <RouteCanvas
              ref={canvasRef}
              routes={filteredRoutes}
              sportColors={sportColors}
              rings={displayRings}
              formatRingLabel={ringLabelFormatter}
            />
          )}

          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-slate-light text-sm">No routes yet. Go record some activities!</p>
            </div>
          )}

          {!isEmpty && (
            <RouteLegend
              sports={filteredSportInfos}
              years={allYears}
              enabledSports={enabledSports}
              enabledYears={enabledYears}
              sportColors={sportColors}
              shownCount={filteredRoutes.length}
              shownDistanceMeters={totalDistanceMeters}
              atLimit={routes.length >= ROUTES_LIMIT}
              limit={ROUTES_LIMIT}
              distanceUnit={userSettings.distanceUnit}
              onToggleSport={handleToggleSport}
              onToggleYear={handleToggleYear}
              onToggleAllSports={handleToggleAllSports}
              onToggleAllYears={handleToggleAllYears}
              showRings={showRings}
              onToggleRings={handleToggleRings}
              onSaveImage={handleSaveImage}
            />
          )}
        </div>
      </div>
    </PageLayout>
  );
}
