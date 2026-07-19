/**
 * Per-sport page background gradients.
 *
 * The primary stop IS the sport's identity color, so it is **derived** from
 * `SPORT_COLORS` rather than restated. It used to be 16 hand-copied duplicates, which
 * meant re-picking the palette would silently desync every page backdrop.
 *
 * What stays declared per sport is the part that is a design choice rather than a
 * derivation: the angle (110-145deg, for variety across pages) and which secondary
 * wash the sport's color pairs with. Greens and yellows deliberately never pair with
 * each other — the wash shifts to cyan or magenta instead.
 */
import { SPORT_COLORS } from "../utils/sportConfig";
import { alpha, tint } from "../utils/colorTokens";

/** Opacity (%) of the two gradient stops. */
const PRIMARY_ALPHA = 18;
const SECONDARY_ALPHA = 8;

/**
 * Secondary wash colors. Cyan/magenta/purple are neon primitives; sky and ocean have
 * no primitive of their own — they are the running/swimming hues reused as a wash,
 * and are left literal so they don't get coupled to those sports' identity colors.
 */
const WASH = {
  cyan: tint("--color-neon-cyan", SECONDARY_ALPHA),
  magenta: tint("--color-neon-magenta", SECONDARY_ALPHA),
  purple: tint("--color-neon-purple", SECONDARY_ALPHA),
  sky: alpha("rgb(0, 200, 255)", SECONDARY_ALPHA),
  ocean: alpha("rgb(0, 150, 255)", SECONDARY_ALPHA),
} as const;

type WashName = keyof typeof WASH;

/** Per-sport gradient geometry: angle, and which wash the sport's color pairs with. */
const SPORT_GRADIENT_SPECS: Record<string, { angle: number; wash: WashName }> = {
  // Endurance — Cyan/Blue family
  cycling: { angle: 130, wash: "magenta" },
  running: { angle: 115, wash: "cyan" },
  swimming: { angle: 135, wash: "cyan" },
  ebike: { angle: 125, wash: "cyan" },

  // Outdoor/Adventure — Green/Teal family
  hiking: { angle: 145, wash: "cyan" },
  walking: { angle: 125, wash: "cyan" },
  winter_sports: { angle: 140, wash: "sky" },
  watersports: { angle: 145, wash: "ocean" },

  // Fitness/Mind-Body — Magenta/Pink family
  yoga: { angle: 120, wash: "purple" },
  workout: { angle: 110, wash: "magenta" },
  climbing: { angle: 115, wash: "magenta" },

  // Ball/Racket — Yellow/Orange family (paired with magenta, not green)
  racket_sports: { angle: 140, wash: "magenta" },
  team_sports: { angle: 110, wash: "magenta" },
  golf: { angle: 135, wash: "cyan" },

  // Alternative Transport — Purple family
  skating: { angle: 130, wash: "sky" },
  wheelchair: { angle: 120, wash: "sky" },
};

/** Fallback for sports with no spec — neutral cyan→magenta, slightly softer primary. */
const DEFAULT_GRADIENT = `linear-gradient(130deg, ${tint("--color-neon-cyan", 15)} 0%, ${WASH.magenta} 100%)`;

export function getSportGradient(sport: string): string {
  const spec = SPORT_GRADIENT_SPECS[sport];
  const color = SPORT_COLORS[sport];
  if (!spec || !color) return DEFAULT_GRADIENT;

  return `linear-gradient(${spec.angle}deg, ${alpha(color, PRIMARY_ALPHA)} 0%, ${WASH[spec.wash]} 100%)`;
}
