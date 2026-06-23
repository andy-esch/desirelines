import type { ExpressionSpecification } from "mapbox-gl";
import type { SportConfig } from "../api/activities";

/**
 * Build a Mapbox data-driven `line-color` expression keyed on the tile's raw
 * Strava `sport` property.
 *
 * The MVT `routes` layer carries the *raw* Strava sport_type (e.g. "Ride",
 * "MountainBikeRide"). We map each raw type to its display category via the
 * sport registry (`sportConfig.sportCategories[*].stravaTypes`), then to that
 * category's color via the caller-supplied `sportColors` (app-category → color).
 *
 * The caller passes the **NEON spectrum** colors (`utils/chartColors`
 * `getSpectrumColor`), the same scheme the dashboard sparklines use — each sport
 * gets a color by its position across Magenta→Cyan→Green→Yellow→Orange — so the
 * map lines, the filter chips, and the sparklines all share one styling. (Keying
 * by raw type stays here because that's what the tile carries; the spectrum index
 * is resolved per app-category in the page, where the dataset is known.)
 *
 * Categories absent from `sportColors` (not present in the dataset) and unmapped
 * raw types fall back to `fallbackColor`. Returns a flat `fallbackColor` when
 * `sportConfig` is null (before the registry loads) so the map still renders.
 */
export function buildSportColorExpression(
  sportConfig: SportConfig | null,
  sportColors: Record<string, string>,
  fallbackColor: string
): ExpressionSpecification | string {
  if (!sportConfig?.sportCategories) {
    return fallbackColor;
  }

  // ["match", ["get", "sport"], <label(s)>, <color>, …, <default>]
  const cases: (string | string[])[] = [];
  const seen = new Set<string>();

  for (const [category, cfg] of Object.entries(sportConfig.sportCategories)) {
    const color = sportColors[category];
    // Only categories present in the dataset (i.e. assigned a spectrum color) get
    // a case; everything else takes the fallback.
    if (!color) continue;
    // Mapbox `match` errors on duplicate labels; a raw type maps to one category.
    const types = (cfg.stravaTypes ?? []).filter((t) => !seen.has(t));
    if (types.length === 0) continue;
    for (const t of types) seen.add(t);
    cases.push(types.length === 1 ? types[0]! : types, color);
  }

  if (cases.length === 0) {
    return fallbackColor;
  }

  return ["match", ["get", "sport"], ...cases, fallbackColor] as unknown as ExpressionSpecification;
}
