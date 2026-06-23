import { useCallback, useMemo, useState } from "react";
import type { ExpressionSpecification } from "mapbox-gl";
import type { MapActivity } from "../api/map";
import {
  type RouteFilterState,
  type ActivityTotals,
  defaultRouteFilters,
  filterMapActivities,
  summarizeMapActivities,
  activityDistanceDomain,
  activityDateDomain,
  buildActivityIdFilter,
  yearRange,
} from "../utils/routeFilters";

export interface UseRouteFiltersResult {
  /** The live filter state (sport/distance/date/region). */
  filters: RouteFilterState;
  /** Activities passing the current filters — the truth for charts/KPIs/list. */
  filteredActivities: MapActivity[];
  /** Ids of `filteredActivities`, for the map cross-filter. */
  filteredIds: number[];
  /**
   * Mapbox `setFilter` expression hiding every route line not in the filtered
   * set (id-set filter). Consumed by the map layer in a later step; exposed here
   * so the map wiring is a one-liner. `null` when the dataset is empty.
   */
  mapFilter: ExpressionSpecification | null;
  /** Aggregate totals of the filtered set (for the KPI/summary readout). */
  totals: ActivityTotals;
  /** `[0, maxDistanceMeters]` over the *full* dataset — the distance slider domain. */
  distanceDomain: [number, number];
  /** `[earliest, today]` over the *full* dataset — the time slider / date-input domain. */
  dateDomain: [string, string];
  /** How many filter dimensions are constraining the set (drives the badge). */
  activeFilterCount: number;
  /** Whether any filter deviates from the defaults. */
  isFiltered: boolean;
  /** Replace sports (app categories); `[]` = all sports. */
  setSports: (sports: string[]) => void;
  /** Add/remove a single sport from the selection. */
  toggleSport: (sport: string) => void;
  /** Set the inclusive `[min, max]` distance window in meters; `null` clears it. */
  setDistanceRange: (range: [number, number] | null) => void;
  /** Set the inclusive `[start, end]` local-date window (YYYY-MM-DD). */
  setDateRange: (range: [string, string]) => void;
  /** Quick-select a calendar year (clamped to today for the current year). */
  selectYear: (year: number) => void;
  /** Restrict to a region id; `null` = all regions. */
  setRegionId: (regionId: number | null) => void;
  /** Replace the whole filter state (escape hatch for chart-segment clicks). */
  setFilters: (next: RouteFilterState) => void;
  /** Reset every filter back to the defaults (current year, all sports/regions). */
  reset: () => void;
  /**
   * Widen to *all* activities: clear sport/distance/region and stretch the date
   * window to the full data domain. The recourse when the default current-year
   * window (or a narrow filter) yields nothing — unlike `reset`, which returns to
   * the current year and so wouldn't surface past-year activities.
   */
  showAll: () => void;
}

/**
 * Owns the routes-map cross-filter state and derives everything the three
 * surfaces (map, charts/KPIs, activity list) read from it — all client-side over
 * the `useMapDataset` model, no refetch on change (see the design spec).
 *
 * `now` is captured once on mount so the default current-year window and the
 * year quick-select stay stable across renders (and is injectable for tests).
 */
export function useRouteFilters(
  activities: MapActivity[],
  options?: { now?: Date }
): UseRouteFiltersResult {
  // Freeze "now" for the lifetime of the hook so re-renders don't drift the
  // default date window. A lazy state initializer (not a ref) keeps it
  // render-safe. Tests pass a fixed date; production reads the clock once.
  const [now] = useState(() => options?.now ?? new Date());

  const [filters, setFilters] = useState<RouteFilterState>(() => defaultRouteFilters(now));

  const setSports = useCallback((sports: string[]) => {
    setFilters((f) => ({ ...f, sports }));
  }, []);

  const toggleSport = useCallback((sport: string) => {
    setFilters((f) => ({
      ...f,
      sports: f.sports.includes(sport) ? f.sports.filter((s) => s !== sport) : [...f.sports, sport],
    }));
  }, []);

  const setDistanceRange = useCallback((distanceRange: [number, number] | null) => {
    setFilters((f) => ({ ...f, distanceRange }));
  }, []);

  const setDateRange = useCallback((dateRange: [string, string]) => {
    setFilters((f) => ({ ...f, dateRange }));
  }, []);

  const selectYear = useCallback(
    (year: number) => {
      setFilters((f) => ({ ...f, dateRange: yearRange(year, now) }));
    },
    [now]
  );

  const setRegionId = useCallback((regionId: number | null) => {
    setFilters((f) => ({ ...f, regionId }));
  }, []);

  const reset = useCallback(() => {
    setFilters(defaultRouteFilters(now));
  }, [now]);

  // Domains depend only on the dataset, not the filters — recompute on data change.
  const distanceDomain = useMemo(() => activityDistanceDomain(activities), [activities]);
  const dateDomain = useMemo(() => activityDateDomain(activities, now), [activities, now]);

  const showAll = useCallback(() => {
    setFilters({
      sports: [],
      distanceRange: null,
      dateRange: [dateDomain[0], dateDomain[1]],
      regionId: null,
    });
  }, [dateDomain]);

  const filteredActivities = useMemo(
    () => filterMapActivities(activities, filters),
    [activities, filters]
  );
  const filteredIds = useMemo(
    () => filteredActivities.map((a) => a.activityId),
    [filteredActivities]
  );
  const mapFilter = useMemo(
    () => (activities.length === 0 ? null : buildActivityIdFilter(filteredIds)),
    [activities.length, filteredIds]
  );
  const totals = useMemo(() => summarizeMapActivities(filteredActivities), [filteredActivities]);

  // A dimension is "active" when it actually constrains the set. Date is compared
  // against the default current-year range (so the badge stays 0 on a fresh load);
  // distance against the full data domain (a slider parked at [0, max] is *not* a
  // constraint, mirroring the date treatment — not merely `distanceRange !== null`).
  const activeFilterCount = useMemo(() => {
    const [defStart, defEnd] = yearRange(now.getFullYear(), now);
    let count = 0;
    if (filters.sports.length > 0) count += 1;
    if (
      filters.distanceRange !== null &&
      (filters.distanceRange[0] > distanceDomain[0] || filters.distanceRange[1] < distanceDomain[1])
    ) {
      count += 1;
    }
    if (filters.regionId !== null) count += 1;
    if (filters.dateRange[0] !== defStart || filters.dateRange[1] !== defEnd) count += 1;
    return count;
  }, [filters, now, distanceDomain]);

  return {
    filters,
    filteredActivities,
    filteredIds,
    mapFilter,
    totals,
    distanceDomain,
    dateDomain,
    activeFilterCount,
    isFiltered: activeFilterCount > 0,
    setSports,
    toggleSport,
    setDistanceRange,
    setDateRange,
    selectYear,
    setRegionId,
    setFilters,
    reset,
    showAll,
  };
}
