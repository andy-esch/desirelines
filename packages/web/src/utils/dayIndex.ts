/**
 * UTC day-index arithmetic for `YYYY-MM-DD` date strings.
 *
 * The routes-map slider and the weekly/cumulative aggregations both need to do
 * arithmetic on calendar dates without a timezone shifting the result. Converting to
 * a UTC day index (days since epoch) and back is TZ-safe because every value is
 * anchored to UTC, never to the viewer's local zone.
 *
 * These lived as near-identical copies in `mapInsights.ts` and `MapTimeRangeFilter.tsx`
 * and had already drifted cosmetically. One copy is enough — a future format or
 * timezone fix should not have to be found twice.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Day index (days since the Unix epoch, UTC) for a `YYYY-MM-DD` string.
 *
 * **Empty or malformed input yields the epoch (day 0, 1970-01-01), not NaN.** The
 * `|| 1970` / `|| 1` fallbacks make `Number("")` — which is `0`, not `NaN` — fall back
 * to epoch parts rather than producing an Invalid Date. Callers that iterate real
 * activity data must therefore filter dateless rows *before* calling this, or a single
 * empty `startDateLocal` silently drags a computed range back to 1970.
 * See `isDateLike` in `routeFilters.ts`.
 */
export function ymdToDay(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / MS_PER_DAY);
}

/** Inverse of {@link ymdToDay}: a UTC day index back to `YYYY-MM-DD`. */
export function dayToYmd(day: number): string {
  const dt = new Date(day * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
