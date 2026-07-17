import type { RouteFilterState } from "./routeFilters";
import { defaultRouteFilters } from "./routeFilters";

/**
 * URL search representation of the Activities-group cross-filter (sports / date /
 * distance / region), shared by `/routes`, `/charts`, and `/activities` so a
 * selection survives switching between the views. Kept as flat, human-readable
 * scalars (not JSON blobs) for clean, shareable links. Every field is optional;
 * an **absent** field means "at its default" — see `searchToFilters`. Defaults are
 * omitted on serialize (`filtersToSearch`) so a pristine map has an empty query.
 */
export interface ActivityFilterSearch {
  /** Comma-joined app-category keys, e.g. "cycling,running". */
  sports?: string;
  /** Inclusive start local date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive end local date (YYYY-MM-DD). */
  to?: string;
  /** Min distance (meters). Paired with `dmax`. */
  dmin?: number;
  /** Max distance (meters). Paired with `dmin`. */
  dmax?: number;
  /**
   * Region id. NOTE: this is the **least portable** filter param — a raw backend
   * region id. A bookmarked/shared `?region=` assumes that id stays stable and present
   * in the dataset; region re-tagging/renumbering (or, under future multi-user,
   * another athlete's dataset) can leave a persisted region filter pointing at the
   * wrong/empty region. It is map-only by nature (non-geo activities have no region),
   * so it must not be carried into non-map views.
   */
  region?: number;
}

function toFiniteNumber(v: unknown): number | undefined {
  // Guard empty/whitespace strings: Number("") === 0 would turn `?region=` into region 0.
  if (typeof v === "string" && v.trim() === "") return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** A real calendar date string (YYYY-MM-DD) — the only date shape we accept. */
function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  // Reject impossible dates (e.g. 2026-02-31): the Date engine rolls them forward, so a
  // valid date must serialize back to itself — otherwise the <input type="date"> that
  // receives the raw string renders blank while the slider sits at the rolled-over day.
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Coerce raw URL search into the typed filter params (a `validateSearch` helper).
 * Defensive against hand-edited / corrupted URLs: malformed dates are dropped (a
 * garbage `?from=oops` would otherwise string-compare in `matchesFilters` and hide
 * every activity, and blank the date input), and crossed date/distance pairs are
 * ordered so a slider never receives `lo > hi` (which can wedge the Base UI Slider).
 */
export function parseActivityFilterSearch(search: Record<string, unknown>): ActivityFilterSearch {
  const out: ActivityFilterSearch = {};
  if (typeof search.sports === "string" && search.sports.length > 0) out.sports = search.sports;

  const from = isYmd(search.from) ? search.from : undefined;
  const to = isYmd(search.to) ? search.to : undefined;
  if (from !== undefined && to !== undefined) {
    out.from = from <= to ? from : to;
    out.to = from <= to ? to : from;
  } else {
    if (from !== undefined) out.from = from;
    if (to !== undefined) out.to = to;
  }

  // Distance is a paired window — keep both or neither, ordered.
  const dmin = toFiniteNumber(search.dmin);
  const dmax = toFiniteNumber(search.dmax);
  if (dmin !== undefined && dmax !== undefined) {
    out.dmin = Math.min(dmin, dmax);
    out.dmax = Math.max(dmin, dmax);
  }

  const region = toFiniteNumber(search.region);
  if (region !== undefined && Number.isInteger(region)) out.region = region;
  return out;
}

/** Deserialize URL search → a full `RouteFilterState`; defaults fill any gaps. */
export function searchToFilters(search: ActivityFilterSearch, now: Date): RouteFilterState {
  const def = defaultRouteFilters(now);
  return {
    sports: search.sports ? search.sports.split(",").filter(Boolean) : def.sports,
    dateRange: [search.from ?? def.dateRange[0], search.to ?? def.dateRange[1]],
    distanceRange:
      search.dmin !== undefined && search.dmax !== undefined
        ? [search.dmin, search.dmax]
        : def.distanceRange,
    regionId: search.region ?? def.regionId,
  };
}

/**
 * Serialize `RouteFilterState` → URL search, omitting anything at its default.
 *
 * The omit-if-default predicate below mirrors `differsFromDefaults` in
 * routeFilters.ts field-for-field (this yields `{}` exactly when that returns
 * false). Adding a filter dimension means updating both.
 */
export function filtersToSearch(filters: RouteFilterState, now: Date): ActivityFilterSearch {
  const def = defaultRouteFilters(now);
  const out: ActivityFilterSearch = {};
  if (filters.sports.length > 0) out.sports = filters.sports.join(",");
  if (filters.dateRange[0] !== def.dateRange[0]) out.from = filters.dateRange[0];
  if (filters.dateRange[1] !== def.dateRange[1]) out.to = filters.dateRange[1];
  if (filters.distanceRange) {
    out.dmin = filters.distanceRange[0];
    out.dmax = filters.distanceRange[1];
  }
  if (filters.regionId !== null) out.region = filters.regionId;
  return out;
}
