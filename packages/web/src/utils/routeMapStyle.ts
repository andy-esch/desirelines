import type { ExpressionSpecification } from "mapbox-gl";
import type { SportConfig } from "../api/activities";
import {
  SPORT_COLORS,
  SPORT_TEXT_COLORS,
  DEFAULT_SPORT_COLOR,
  DEFAULT_SPORT_TEXT_COLOR,
} from "./sportConfig";

/**
 * Build a Mapbox data-driven `line-color` expression keyed on the tile's raw
 * Strava `sport` property.
 *
 * The MVT `routes` layer carries the *raw* Strava sport_type (e.g. "Ride",
 * "MountainBikeRide"). We map each raw type to its display category via the
 * sport registry (`sportConfig.sportCategories[*].stravaTypes`), then to that
 * category's palette color, reusing the per-sport color *intent* from the old
 * route canvas. Unknown / unmapped types fall back to the default color.
 *
 * Theme-aware (like the old `RouteCanvas` light/dark palettes): the dark basemap
 * uses the full-brightness neon `SPORT_COLORS`; the light basemap uses the
 * darker `SPORT_TEXT_COLORS` so lines stay legible on a light background. The
 * full 80s-neon glow treatment is a follow-on task.
 *
 * Returns a flat color when `sportConfig` is null (e.g. before the registry
 * loads) so the map still renders.
 */
export function buildSportColorExpression(
  sportConfig: SportConfig | null,
  isDark: boolean
): ExpressionSpecification | string {
  const palette = isDark ? SPORT_COLORS : SPORT_TEXT_COLORS;
  const fallbackColor = isDark ? DEFAULT_SPORT_COLOR : DEFAULT_SPORT_TEXT_COLOR;

  if (!sportConfig?.sportCategories) {
    return fallbackColor;
  }

  // ["match", ["get", "sport"], <label(s)>, <color>, …, <default>]
  const cases: (string | string[])[] = [];
  const seen = new Set<string>();

  for (const [category, cfg] of Object.entries(sportConfig.sportCategories)) {
    const color = palette[category] ?? fallbackColor;
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
