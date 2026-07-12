import type { ExpressionSpecification } from "mapbox-gl";
import type { MapActivity } from "../api/map";

/**
 * Cross-filter state for the routes map. One state object drives all three
 * surfaces (per the design spec): the map (`setFilter` over the filtered
 * activity-id set), the charts/KPIs (aggregate the filtered set), and the
 * activity list (render the filtered set). All filtering is client-side over the
 * `useMapDataset` model — no refetch on change.
 */
export interface RouteFilterState {
  /** App sport categories to include; empty = all sports. */
  sports: string[];
  /** Inclusive [min, max] distance in meters; null = no distance constraint. */
  distanceRange: [number, number] | null;
  /** Inclusive [start, end] local dates (YYYY-MM-DD). */
  dateRange: [string, string];
  /** Region id to restrict to; null = all regions. */
  regionId: number | null;
}

/** Local date portion (YYYY-MM-DD) of an athlete-local ISO timestamp — no TZ
 * conversion (start_date_local is already athlete local time). */
export function toLocalDate(isoLocal: string): string {
  return isoLocal.slice(0, 10);
}

/** Today's local date as YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Date range for a calendar year: Jan 1 → Dec 31, clamped to today for the
 * current year (no point filtering into the future). Drives the year
 * quick-select and the default (current year) range.
 */
export function yearRange(year: number, now: Date = new Date()): [string, string] {
  const start = `${year}-01-01`;
  const end = year === now.getFullYear() ? todayLocal(now) : `${year}-12-31`;
  return [start, end];
}

/**
 * The "My sports" map-filter preset: the user's app-wide visible-sports
 * preference narrowed to the sports actually present in the map dataset. An
 * opted-in sport with no geo-bearing activities has no route line, so it drops
 * out here (and the preset button then hides when nothing — or everything — is
 * left). `visibleSports` is already registry-validated by `useVisibleSports`,
 * so no further key-validation is needed.
 */
export function mapPresetSports(visibleSports: string[], presentSports: string[]): string[] {
  const presentSet = new Set(presentSports);
  return visibleSports.filter((s) => presentSet.has(s));
}

/** Default filters: current year, all sports/regions, no distance constraint. */
export function defaultRouteFilters(now: Date = new Date()): RouteFilterState {
  return {
    sports: [],
    distanceRange: null,
    dateRange: yearRange(now.getFullYear(), now),
    regionId: null,
  };
}

/** [0, maxDistanceMeters] for the distance slider domain (0 when empty). */
export function activityDistanceDomain(activities: MapActivity[]): [number, number] {
  let max = 0;
  for (const a of activities) if (a.distanceMeters > max) max = a.distanceMeters;
  return [0, max];
}

/**
 * [earliest local date, today] for the time-range slider / date inputs domain.
 * Falls back to [today, today] when there are no activities.
 */
export function activityDateDomain(
  activities: MapActivity[],
  now: Date = new Date()
): [string, string] {
  const today = todayLocal(now);
  let earliest = today;
  for (const a of activities) {
    const d = toLocalDate(a.startDateLocal);
    if (d < earliest) earliest = d;
  }
  return [earliest, today];
}

/** Whether a single activity passes the current filters. */
export function matchesFilters(activity: MapActivity, filters: RouteFilterState): boolean {
  if (filters.sports.length > 0 && !filters.sports.includes(activity.sport)) return false;

  if (filters.distanceRange) {
    const [min, max] = filters.distanceRange;
    if (activity.distanceMeters < min || activity.distanceMeters > max) return false;
  }

  const date = toLocalDate(activity.startDateLocal);
  if (date < filters.dateRange[0] || date > filters.dateRange[1]) return false;

  if (filters.regionId !== null && !activity.regionIds.includes(filters.regionId)) return false;

  return true;
}

/** The subset of activities passing the current filters. */
export function filterMapActivities(
  activities: MapActivity[],
  filters: RouteFilterState
): MapActivity[] {
  return activities.filter((a) => matchesFilters(a, filters));
}

/**
 * Mapbox filter expression hiding every route line whose `activity_id` is not in
 * the filtered set. A single id-set filter (rather than per-property expressions)
 * uniformly applies sport/distance/date/region — and sidesteps the tile's raw
 * Strava `sport` vs the dataset's app-category mismatch.
 */
export function buildActivityIdFilter(filteredIds: number[]): ExpressionSpecification {
  return ["in", ["get", "activity_id"], ["literal", filteredIds]] as ExpressionSpecification;
}

/** Aggregate totals for the KPI cards / active-filter summary. */
export interface ActivityTotals {
  count: number;
  distanceMeters: number;
  movingTimeSeconds: number;
  elevationMeters: number;
}

export function summarizeMapActivities(activities: MapActivity[]): ActivityTotals {
  const totals: ActivityTotals = {
    count: activities.length,
    distanceMeters: 0,
    movingTimeSeconds: 0,
    elevationMeters: 0,
  };
  for (const a of activities) {
    totals.distanceMeters += a.distanceMeters;
    totals.movingTimeSeconds += a.movingTime;
    totals.elevationMeters += a.elevationMeters ?? 0;
  }
  return totals;
}
