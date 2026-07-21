import type { ActivitySummary } from "../api/activities";

/**
 * Client-side filter for the demo activity set — signed-out mode has no backend
 * to filter server-side, so the hooks apply the same semantics the list API
 * would: `sports` is a set of app sport categories (empty = all sports), and
 * `from`/`to` are inclusive local dates (YYYY-MM-DD).
 *
 * Dates compare as strings against the local-date part of `startDateLocal` —
 * athlete wall-clock, stored as-if-UTC — so there is no Date()/UTC round-trip
 * that could shift a boundary day in UTC-negative timezones.
 */
export function filterDemoActivities(
  activities: ActivitySummary[],
  filter: {
    sports?: string[] | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }
): ActivitySummary[] {
  const { sports, from, to } = filter;
  return activities.filter((a) => {
    if (sports?.length && !sports.includes(a.sport)) return false;
    const day = a.startDateLocal.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}
