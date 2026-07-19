/**
 * Forward filters when switching between the Activities-group views.
 *
 * All three views share the `sports` param, so it passes straight through — no per-view
 * translation. The rest of each model differs (List/Charts add a preset `range`; the
 * Routes map adds a date range + distance + region), so we forward ONLY the destination's
 * own params and nothing incompatible lingers in the URL. The time filter has no
 * cross-model equivalent, so it doesn't cross the Routes boundary; a multi-sport `sports`
 * carries as-is and the single-select List/Charts views use the first of it.
 */
type AnySearch = Record<string, unknown>;

export function forwardActivitiesGroupSearch(to: string, prev: AnySearch): AnySearch {
  const next: AnySearch = {};
  if (prev.sports !== undefined) next.sports = prev.sports; // shared by all three views

  if (to === "/routes") {
    for (const key of ["from", "to", "dmin", "dmax", "region"] as const) {
      if (prev[key] !== undefined) next[key] = prev[key];
    }
    return next;
  }

  // "/charts" or "/activities"
  if (typeof prev.range === "string") next.range = prev.range;
  return next;
}
