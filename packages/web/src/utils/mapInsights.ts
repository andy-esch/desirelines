import type { MapActivity } from "../api/map";

// These aggregations run on activities already validated + coerced by zod at the API
// boundary (`api/map.ts` MapActivitySchema): ids/scalars are finite numbers and
// `regionIds` is always present. The `?? 0` and skip-NaN guards below are therefore
// belt-and-suspenders — cheap insurance against a future unvalidated caller — with
// zod as the primary guard.

/** Per-sport rollup of the (filtered) activity set, for the insights breakdown. */
export interface SportBreakdownRow {
  sport: string;
  count: number;
  distanceMeters: number;
  movingTimeSeconds: number;
  elevationMeters: number;
}

/** The metric a breakdown is ranked/sized by. */
export type BreakdownMetric = "distance" | "time" | "count";

/** Aggregate activities by app-sport category. Unordered (caller sorts). */
export function sportBreakdown(activities: MapActivity[]): SportBreakdownRow[] {
  const bySport = new Map<string, SportBreakdownRow>();
  for (const a of activities) {
    const row = bySport.get(a.sport) ?? {
      sport: a.sport,
      count: 0,
      distanceMeters: 0,
      movingTimeSeconds: 0,
      elevationMeters: 0,
    };
    row.count += 1;
    row.distanceMeters += a.distanceMeters ?? 0;
    row.movingTimeSeconds += a.movingTime ?? 0;
    row.elevationMeters += a.elevationMeters ?? 0;
    bySport.set(a.sport, row);
  }
  return [...bySport.values()];
}

/** The value of a breakdown row for the chosen metric. */
export function breakdownValue(row: SportBreakdownRow, metric: BreakdownMetric): number {
  switch (metric) {
    case "distance":
      return row.distanceMeters;
    case "time":
      return row.movingTimeSeconds;
    case "count":
      return row.count;
  }
}

/** Rows ranked by the chosen metric, descending (drives the bar order + scale). */
export function rankedSportBreakdown(
  activities: MapActivity[],
  metric: BreakdownMetric
): SportBreakdownRow[] {
  return sportBreakdown(activities).sort(
    (a, b) => breakdownValue(b, metric) - breakdownValue(a, metric)
  );
}

// --- date helpers (UTC day math → TZ-safe) -------------------------------------
function ymdToDay(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / 86_400_000);
}
function dayToYmd(day: number): string {
  const dt = new Date(day * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}
/** Monday (ISO week start) for the week containing `ymd`, as YYYY-MM-DD. */
function weekStartYmd(ymd: string): string {
  const day = ymdToDay(ymd);
  const dow = new Date(day * 86_400_000).getUTCDay(); // 0=Sun … 6=Sat
  return dayToYmd(day - ((dow + 6) % 7)); // back up to Monday
}

/** Distance + time + count per ISO week (Monday), ascending by week. */
export interface WeeklyVolumeRow {
  weekStart: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  count: number;
}
export function weeklyVolume(activities: MapActivity[]): WeeklyVolumeRow[] {
  const byWeek = new Map<string, WeeklyVolumeRow>();
  for (const a of activities) {
    const ws = weekStartYmd(a.startDateLocal);
    const row = byWeek.get(ws) ?? {
      weekStart: ws,
      distanceMeters: 0,
      movingTimeSeconds: 0,
      count: 0,
    };
    row.distanceMeters += a.distanceMeters ?? 0;
    row.movingTimeSeconds += a.movingTime ?? 0;
    row.count += 1;
    byWeek.set(ws, row);
  }
  return [...byWeek.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

/** A "nice" bin width (1/2/5 × 10ⁿ) at or above `raw`, for tidy histogram edges. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / pow;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return niceFrac * pow;
}

/** A distance histogram bin (meters) + how many activities fall in it. */
export interface HistogramBin {
  start: number;
  end: number;
  count: number;
}
/** Bin activities by distance into ~`binCount` nice-width buckets (meters). */
export function distanceHistogram(activities: MapActivity[], binCount = 8): HistogramBin[] {
  // `>` comparison (not Math.max) so a NaN/negative distance can't poison `max`
  // (Math.max(0, NaN) === NaN, which would cascade into NaN step/bins → crash).
  const max = activities.reduce((m, a) => (a.distanceMeters > m ? a.distanceMeters : m), 0);
  if (max <= 0) return [];
  const step = niceStep(max / binCount);
  const nBins = Math.max(1, Math.ceil(max / step));
  const bins: HistogramBin[] = Array.from({ length: nBins }, (_, i) => ({
    start: i * step,
    end: (i + 1) * step,
    count: 0,
  }));
  for (const a of activities) {
    // Skip negative / non-finite distances (corrupt GPS / manual-entry) — they'd
    // produce a negative or NaN bin index → out-of-bounds crash.
    if (!(a.distanceMeters >= 0)) continue;
    const idx = Math.min(nBins - 1, Math.floor(a.distanceMeters / step));
    bins[idx]!.count += 1;
  }
  return bins;
}

/** Per-region rollup of the filtered set (an activity counts in each of its regions). */
export interface RegionBreakdownRow {
  regionId: number;
  count: number;
  distanceMeters: number;
}
export function regionBreakdown(activities: MapActivity[]): RegionBreakdownRow[] {
  const byRegion = new Map<number, RegionBreakdownRow>();
  for (const a of activities) {
    for (const rid of a.regionIds ?? []) {
      const row = byRegion.get(rid) ?? { regionId: rid, count: 0, distanceMeters: 0 };
      row.count += 1;
      row.distanceMeters += a.distanceMeters ?? 0;
      byRegion.set(rid, row);
    }
  }
  return [...byRegion.values()];
}

/** Running total of distance by day (ascending), for the cumulative line. */
export interface CumulativePoint {
  date: string;
  cumulativeMeters: number;
}
export function cumulativeDistance(activities: MapActivity[]): CumulativePoint[] {
  const byDay = new Map<string, number>();
  for (const a of activities) {
    const d = a.startDateLocal.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + (a.distanceMeters ?? 0));
  }
  let sum = 0;
  return [...byDay.keys()].sort().map((date) => {
    sum += byDay.get(date)!;
    return { date, cumulativeMeters: sum };
  });
}
