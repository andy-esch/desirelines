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
  /** Region id. */
  region?: number;
}

function toFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce raw URL search into the typed filter params (a `validateSearch` helper). */
export function parseActivityFilterSearch(search: Record<string, unknown>): ActivityFilterSearch {
  const out: ActivityFilterSearch = {};
  if (typeof search.sports === "string" && search.sports.length > 0) out.sports = search.sports;
  if (typeof search.from === "string") out.from = search.from;
  if (typeof search.to === "string") out.to = search.to;
  const dmin = toFiniteNumber(search.dmin);
  const dmax = toFiniteNumber(search.dmax);
  // Distance is a paired window — keep both or neither so it round-trips cleanly.
  if (dmin !== undefined && dmax !== undefined) {
    out.dmin = dmin;
    out.dmax = dmax;
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

/** Serialize `RouteFilterState` → URL search, omitting anything at its default. */
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
