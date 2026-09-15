import type { ThemeStructure } from "../../themes/registry";

/**
 * Miami's sunset: a flat sky over the top half, then six hard bands with no blending.
 * The stops are shares of the hero's height, so the headline always sits on sky.
 */
const SUNSET_BANDS =
  "linear-gradient(180deg, #2a0f4d 0 50%, #45125a 50% 60%, #6a1762 60% 69%, #9a1d68 69% 77%, #c2266b 77% 85%, #e54a55 85% 92%, #ff7a3d 92% 100%)";

/** Blinds across the bottom 58px in the page ground, thickening toward the bottom. */
const SUNSET_BLINDS = [
  "transparent 0 8px",
  "var(--color-bg-body) 8px 10px",
  "transparent 10px 18px",
  "var(--color-bg-body) 18px 21px",
  "transparent 21px 28px",
  "var(--color-bg-body) 28px 32px",
  "transparent 32px 38px",
  "var(--color-bg-body) 38px 43px",
  "transparent 43px 48px",
  "var(--color-bg-body) 48px 54px",
  "transparent 54px 58px",
].join(", ");

/**
 * The decoration behind a hero band, per the theme's `heroDecoration`. The recipes are
 * fixed artwork, so they live here rather than in slots. Hero content must clear the
 * bottom of the band, which the theme's `--hero-padding` accounts for.
 */
export function HeroDecoration({ kind }: { kind: ThemeStructure["heroDecoration"] }) {
  if (kind !== "sunset") return null;
  return (
    <>
      <div aria-hidden="true" className="absolute inset-0" style={{ background: SUNSET_BANDS }} />
      <div
        aria-hidden="true"
        data-decoration="sunset-blinds"
        className="absolute inset-x-0 bottom-0 h-[58px]"
        style={{ background: `linear-gradient(180deg, ${SUNSET_BLINDS})` }}
      />
    </>
  );
}
