/**
 * NEON spectrum ramp — positional color generation.
 *
 * Interpolates across a neon spectrum (Magenta -> Cyan -> Green -> Yellow -> Orange)
 * to produce N evenly-spaced colors. Used by the sparklines, weekly summary, goals
 * list, and routes map.
 *
 * Named for the ramp, not for "charts", because there is a second and unrelated
 * `constants/chartColors.ts` (the goal-ladder + data-line colors) — two modules with
 * the same basename was a standing confusion.
 *
 * NOTE: `getSpectrumColor(index, total)` assigns color by *rank among the sports
 * currently present*, so changing the sport set repaints the survivors. That is a
 * known issue: the agreed direction is for each sport to own a frozen stop on this
 * ramp instead, keeping the ramp as the generator but making the color stable per
 * sport. Until then this module stays positional.
 *
 * @see sportConfig.ts - Fixed per-sport identity colors (charts, chips, badges)
 */

/**
 * NEON spectrum colors for sparklines (top to bottom).
 * Progression: Magenta -> Cyan -> Green -> Yellow -> Orange
 */
const SPARKLINE_SPECTRUM = [
  { r: 255, g: 0, b: 255 }, // Magenta (top)
  { r: 0, g: 255, b: 255 }, // Electric Cyan
  { r: 0, g: 255, b: 128 }, // Neon Green-Cyan
  { r: 255, g: 200, b: 0 }, // Neon Yellow-Orange
  { r: 255, g: 95, b: 31 }, // Orange (bottom)
] as const;

/**
 * Interpolate between two RGB colors.
 */
function interpolateColor(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number },
  t: number
): { r: number; g: number; b: number } {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  };
}

/**
 * Get the interpolated RGB color at a position in the NEON spectrum.
 */
function getInterpolatedSpectrumColor(
  index: number,
  total: number
): { r: number; g: number; b: number } {
  if (total <= 1) return { ...SPARKLINE_SPECTRUM[0] };

  const t = index / (total - 1);
  const numSegments = SPARKLINE_SPECTRUM.length - 1;
  const segmentIndex = Math.min(Math.floor(t * numSegments), numSegments - 1);
  const segmentT = t * numSegments - segmentIndex;

  const start = SPARKLINE_SPECTRUM[segmentIndex] ?? SPARKLINE_SPECTRUM[0];
  const end = SPARKLINE_SPECTRUM[segmentIndex + 1] ?? SPARKLINE_SPECTRUM[0];
  return interpolateColor(start, end, segmentT);
}

/**
 * Generate a NEON spectrum color based on position.
 * Interpolates through: Magenta -> Cyan -> Green -> Yellow -> Orange (top to bottom)
 */
export function getSpectrumColor(index: number, total: number): string {
  const c = getInterpolatedSpectrumColor(index, total);
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}
