import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExpressionSpecification } from "mapbox-gl";
import type { MapActivity } from "../api/map";
import {
  type RouteFilterState,
  type ActivityTotals,
  defaultRouteFilters,
  differsFromDefaults,
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
  /** Shorthand for `activeFilterCount > 0` — whether the view is constrained. */
  isFiltered: boolean;
  /**
   * Whether `reset()` would change anything, i.e. the filters differ from the
   * defaults. NOT interchangeable with `isFiltered` — the two disagree in both
   * directions (a fresh load is constrained but not resettable; Show-all is
   * resettable but not constrained). Gate reset affordances on this.
   */
  canReset: boolean;
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
  options?: {
    now?: Date;
    /** Controlled mode: the current filter state (e.g. deserialized from the URL). */
    value?: RouteFilterState;
    /** Controlled mode: receives the next state instead of it being set internally. */
    onChange?: (next: RouteFilterState) => void;
  }
): UseRouteFiltersResult {
  // Freeze a fallback "now" for the hook's lifetime (so re-renders don't drift the
  // default date window) but still honor an explicitly-passed `options.now` if it
  // changes — production omits it (stable clock); tests can update it.
  const [fallbackNow] = useState(() => new Date());
  const now = options?.now ?? fallbackNow;

  // Uncontrolled by default (internal state). When `value` + `onChange` are supplied
  // (e.g. URL-backed on the routes page) the hook is *controlled*: `filters` reads
  // `value` and every setter routes the next state through `onChange` instead of
  // setting internally. Extracting the two as consts lets TS narrow them from the
  // `controlled` alias (no casts) and keeps `applyFilters` stable in uncontrolled use.
  const controlledValue = options?.value;
  const onChange = options?.onChange;
  const controlled = controlledValue !== undefined && onChange !== undefined;
  const [internal, setInternal] = useState<RouteFilterState>(() => defaultRouteFilters(now));
  const filters = controlled ? controlledValue : internal;

  // Keep the setters below referentially STABLE across renders (so memoized children —
  // map controls, charts — don't re-render just because a filter changed). `applyFilters`
  // reads the live filters/onChange from a ref updated in an effect (NOT during render —
  // that trips the no-refs-during-render rule) rather than closing over them via deps.
  const live = useRef({ filters, onChange, controlled });
  useEffect(() => {
    live.current = { filters, onChange, controlled };
  }, [filters, onChange, controlled]);

  // CONTRACT: in *controlled* mode a functional update reads the current filters, so a
  // caller must apply at most ONE mutation per tick — two synchronous setter calls would
  // both read the pre-update value and the second would win (last-write-wins). Uncontrolled
  // mode batches functional updaters via setState and is unaffected. Every current call
  // site mutates once per user event; keep it so.
  const applyFilters = useCallback(
    (updater: RouteFilterState | ((f: RouteFilterState) => RouteFilterState)) => {
      const { controlled: isControlled, onChange: emit, filters: current } = live.current;
      if (isControlled && emit) {
        emit(typeof updater === "function" ? updater(current) : updater);
      } else {
        setInternal(updater);
      }
    },
    []
  );

  const setSports = useCallback(
    (sports: string[]) => applyFilters((f) => ({ ...f, sports })),
    [applyFilters]
  );

  const toggleSport = useCallback(
    (sport: string) =>
      applyFilters((f) => ({
        ...f,
        sports: f.sports.includes(sport)
          ? f.sports.filter((s) => s !== sport)
          : [...f.sports, sport],
      })),
    [applyFilters]
  );

  const setDistanceRange = useCallback(
    (distanceRange: [number, number] | null) => applyFilters((f) => ({ ...f, distanceRange })),
    [applyFilters]
  );

  const setDateRange = useCallback(
    (dateRange: [string, string]) => applyFilters((f) => ({ ...f, dateRange })),
    [applyFilters]
  );

  const selectYear = useCallback(
    (year: number) => applyFilters((f) => ({ ...f, dateRange: yearRange(year, now) })),
    [applyFilters, now]
  );

  const setRegionId = useCallback(
    (regionId: number | null) => applyFilters((f) => ({ ...f, regionId })),
    [applyFilters]
  );

  const reset = useCallback(() => applyFilters(defaultRouteFilters(now)), [applyFilters, now]);

  // Domains depend only on the dataset, not the filters — recompute on data change.
  const distanceDomain = useMemo(() => activityDistanceDomain(activities), [activities]);
  const dateDomain = useMemo(() => activityDateDomain(activities, now), [activities, now]);

  const showAll = useCallback(() => {
    applyFilters({
      sports: [],
      distanceRange: null,
      dateRange: [dateDomain[0], dateDomain[1]],
      regionId: null,
    });
  }, [applyFilters, dateDomain]);

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

  // A dimension is "active" when it actually constrains the set — i.e. when it
  // narrows the data *domain*. Every dimension is measured that way, date included:
  // a slider parked at [0, max] or a window spanning the full date domain excludes
  // nothing, so neither counts.
  //
  // Date was previously measured against the default current-year range so the badge
  // read 0 on a fresh load. That broke the invariant above: `showAll()` sets the date
  // window to the full domain, which for multi-year data is != this Jan 1, so the
  // un-filter action reported 1 active filter and offered a Reset for a view that
  // excludes nothing. Domain-relative is the honest reading — on multi-year data a
  // fresh current-year load genuinely IS constrained, and now says so.
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.sports.length > 0) count += 1;
    if (
      filters.distanceRange !== null &&
      (filters.distanceRange[0] > distanceDomain[0] || filters.distanceRange[1] < distanceDomain[1])
    ) {
      count += 1;
    }
    if (filters.regionId !== null) count += 1;
    if (filters.dateRange[0] > dateDomain[0] || filters.dateRange[1] < dateDomain[1]) count += 1;
    return count;
  }, [filters, distanceDomain, dateDomain]);

  // Whether reset() would change anything. Deliberately NOT the same question as
  // activeFilterCount — the two disagree at both ends:
  //
  //   fresh load    → constrains (count 1, badge shown) but reset is a no-op (false)
  //   after showAll → constrains nothing (count 0, no badge) but reset would narrow
  //                   back to this year, so it's a real action (true)
  //
  // Gate reset affordances on this; gate badges/"filtered" copy on the count.
  // Conflating them is what produced the phantom Reset this hook used to show.
  const canReset = useMemo(() => differsFromDefaults(filters, now), [filters, now]);

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
    canReset,
    setSports,
    toggleSport,
    setDistanceRange,
    setDateRange,
    selectYear,
    setRegionId,
    setFilters: applyFilters,
    reset,
    showAll,
  };
}
