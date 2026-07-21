/**
 * The Activities-group cross-view URL search model in one place: `sports` is
 * shared by all three views (/activities, /charts, /routes); `range` (time
 * presets) belongs to List + Charts only; the map owns an explicit date window
 * plus distance/region/deep-link params. Each route's stripSearchParams
 * middleware consumes these lists so a navigation drops exactly the params the
 * destination doesn't model — adding a param to one view means updating the
 * other views' strip list here, in one edit.
 */

/** Params only the routes map models; stripped on navigation to List/Charts. */
export const MAP_ONLY_SEARCH_PARAMS = ["from", "to", "dmin", "dmax", "region", "activity"] as const;

/** Params only List/Charts model; stripped on navigation to the map. */
export const LIST_CHARTS_ONLY_SEARCH_PARAMS = ["range"] as const;

/**
 * The search a cross-view nav link forwards: only the shared params, never the
 * rest of the current location. Forwarding everything (`search: true`) would
 * leak params that the strip middlewares never saw — they run on navigation,
 * not initial load, so a bookmarked List URL carrying map params would hand
 * them to the map on the next click (an unexpected date window or activity
 * deep link). `range` is included even map-bound: the map's middleware strips
 * it, keeping this pick destination-agnostic.
 */
export function pickActivitiesGroupSearch(prev: { sports?: unknown; range?: unknown }): {
  sports?: string;
  range?: string;
} {
  const next: { sports?: string; range?: string } = {};
  if (typeof prev.sports === "string" && prev.sports) next.sports = prev.sports;
  if (typeof prev.range === "string" && prev.range) next.range = prev.range;
  return next;
}
