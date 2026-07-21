import type { ActivitySummary, ActivityBucket } from "../api/activities";

/**
 * One aggregated cell of the Charts view: a (month × sport × geographic) group
 * with its summed measures.
 *
 * The bucket shape is the generated proto type — the same rows
 * `GET /v1/activities/summary` returns from SQL — re-exported here so the
 * client-side aggregation below cannot drift from it. Signed in, the chart
 * reads the endpoint; signed out (demo mode, no backend) it aggregates the
 * generated activity set with `aggregateActivities`. Both paths therefore feed
 * the chart identical rows.
 *
 * Note the two differ in how `geographic` is decided: the server applies the
 * full predicate (no trainer/manual flag, not a Virtual type, and stored route
 * geometry), while the client can only see `hasRoute`. That is acceptable
 * precisely because the client path is demo-only.
 */
export type { ActivityBucket };

/**
 * Aggregate a flat activity list into (month × sport × geographic) buckets.
 *
 * Pure and deterministic: same input → same output, no clock, no I/O. The month
 * key is the first 7 chars of `startDateLocal` ("YYYY-MM-…"), taken as-is —
 * `startDateLocal` is athlete-local wall-clock time, so slicing avoids the
 * timezone shift a `new Date()` round-trip would introduce (an activity logged at
 * 00:30 local on the 1st must not roll into the previous month in UTC).
 *
 * Buckets are returned sorted by month ascending, then sport ascending, then
 * geographic (false before true) — a stable order so the chart's stack/series
 * assignment doesn't jitter between renders.
 */
/** Non-negative finite number, else 0 — keeps a NaN/negative field from poisoning a sum. */
function safeMeasure(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

export function aggregateActivities(activities: ActivitySummary[]): ActivityBucket[] {
  const byKey = new Map<string, ActivityBucket>();

  for (const a of activities) {
    // Defensive: a malformed/empty startDateLocal can't form a real month bucket,
    // and a "1969"/"" bucket would poison the axis — skip rather than guess.
    if (typeof a.startDateLocal !== "string" || !/^\d{4}-\d{2}/.test(a.startDateLocal)) continue;
    const month = a.startDateLocal.slice(0, 7);
    // Coerce hasRoute to a real boolean: null/undefined must land firmly as
    // non-geographic, not `undefined` (which matches neither Outdoor nor Indoor in
    // filterBucketsByType and would drop the activity from both filtered views).
    const geographic = Boolean(a.hasRoute);

    const key = `${month}\x00${a.sport}\x00${a.hasRoute ? "1" : "0"}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        month,
        sport: a.sport,
        geographic,
        count: 0,
        movingTimeSeconds: 0,
        distanceMeters: 0,
      };
      byKey.set(key, bucket);
    }
    bucket.count += 1;
    bucket.movingTimeSeconds += safeMeasure(a.movingTimeSeconds);
    bucket.distanceMeters += safeMeasure(a.distanceMeters);
  }

  return [...byKey.values()].sort(
    (x, y) =>
      x.month.localeCompare(y.month) ||
      x.sport.localeCompare(y.sport) ||
      Number(x.geographic) - Number(y.geographic)
  );
}

/** The three measures a bucket can be charted by. */
export type BucketMetric = "distanceMeters" | "movingTimeSeconds" | "count";

/**
 * Which activities to include, by geography. A first-class filter (not a visual
 * encoding): "all" combines both, "outdoor" keeps geographic (hasRoute) only,
 * "indoor" keeps non-geographic (indoor/virtual) only.
 */
export type ActivityTypeFilter = "all" | "outdoor" | "indoor";

/** Keep only the buckets matching the geography filter. */
export function filterBucketsByType(
  buckets: ActivityBucket[],
  type: ActivityTypeFilter
): ActivityBucket[] {
  if (type === "all") return buckets;
  const wantGeographic = type === "outdoor";
  return buckets.filter((b) => b.geographic === wantGeographic);
}

/** One stackable series of the chart: a sport. */
export interface ChartSeries {
  /** Stable data key used in the pivoted rows and the recharts `<Bar>` (the sport). */
  key: string;
  sport: string;
}

/** A pivoted month row: the month plus one numeric field per series key. */
export type ChartRow = { month: string } & Record<string, number | string>;

/** Result of pivoting buckets for a stacked bar chart. */
export interface ChartData {
  /** One row per month, each carrying every series key (0 when absent). */
  rows: ChartRow[];
  /** The sports to render as stacked `<Bar>`s, in a stable alphabetical order. */
  series: ChartSeries[];
}

/**
 * Every "YYYY-MM" month from `from` to `to` inclusive (both "YYYY-MM-DD"). Used to
 * give the chart a continuous time axis — a selected range shows all its months,
 * with empty ones flat at zero, rather than collapsing to only months with data.
 * Returns [] if either bound is missing (an unbounded "all" range).
 */
export function monthsInRange(from: string | undefined, to: string | undefined): string[] {
  if (!from || !to) return [];
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  let y = fy!;
  let m = fm!;
  while (y < ty! || (y === ty! && m <= tm!)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Pivot buckets into stacked-bar chart rows + series for the given metric,
 * stacked by sport (geography is applied earlier via filterBucketsByType).
 *
 * Pure. `monthAxis`, when non-empty, is the exact set of month rows to emit (from
 * the selected range) so empty months still appear; otherwise rows are just the
 * months present in the buckets. Series are the sports present, alphabetical, so a
 * filter change never repaints or reorders the survivors (color follows the sport,
 * never its rank).
 */
export function toChartData(
  buckets: ActivityBucket[],
  metric: BucketMetric,
  monthAxis: string[] = []
): ChartData {
  const bucketMonths = new Set(buckets.map((b) => b.month));
  const months =
    monthAxis.length > 0
      ? [...new Set([...monthAxis, ...bucketMonths])].sort()
      : [...bucketMonths].sort();

  const sports = [...new Set(buckets.map((b) => b.sport))].sort();
  // Namespace the row data key ("s:<sport>") so a sport literally named "month"
  // (or any future reserved row field) can't overwrite row.month — which would
  // hand Recharts a number where the XAxis expects the "YYYY-MM" string and crash
  // formatMonthLabel. series.key is the row/Bar key; series.sport is the clean name.
  const series: ChartSeries[] = sports.map((sport) => ({ key: seriesKey(sport), sport }));

  const rowByMonth = new Map<string, ChartRow>();
  for (const month of months) {
    const row: ChartRow = { month };
    for (const s of series) row[s.key] = 0;
    rowByMonth.set(month, row);
  }
  for (const b of buckets) {
    const row = rowByMonth.get(b.month)!;
    const key = seriesKey(b.sport);
    row[key] = (row[key] as number) + b[metric];
  }

  return { rows: months.map((m) => rowByMonth.get(m)!), series };
}

/** Row/Bar data key for a sport, namespaced so it can never collide with "month". */
export function seriesKey(sport: string): string {
  return `s:${sport}`;
}
