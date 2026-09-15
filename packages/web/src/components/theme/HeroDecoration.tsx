import type { ThemeStructure } from "../../themes/registry";

/**
 * Miami's sunset: a flat sky over the top half, then six hard bands with no blending.
 *
 * The upper stops are shares of the hero's height, so the headline always sits on sky. The
 * three brightest bands are too light for the hero's text, so they sit a fixed distance
 * from the bottom (where a 230px desktop hero puts them), inside the bottom padding that
 * content never enters. A taller hero on a phone stretches the upper bands instead of
 * sliding text onto the light ones. `HeroDecoration.test.ts` holds the text contrast.
 */
export const SUNSET_STOPS = [
  { color: "#2a0f4d", from: "0", to: "50%", behindText: true },
  { color: "#45125a", from: "50%", to: "60%", behindText: true },
  { color: "#6a1762", from: "60%", to: "69%", behindText: true },
  { color: "#9a1d68", from: "69%", to: "calc(100% - 52px)", behindText: true },
  { color: "#c2266b", from: "calc(100% - 52px)", to: "calc(100% - 34px)", behindText: false },
  { color: "#e54a55", from: "calc(100% - 34px)", to: "calc(100% - 18px)", behindText: false },
  { color: "#ff7a3d", from: "calc(100% - 18px)", to: "100%", behindText: false },
] as const;

const SUNSET_BANDS = `linear-gradient(180deg, ${SUNSET_STOPS.map((s) => `${s.color} ${s.from} ${s.to}`).join(", ")})`;

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
 * bottom of the band, which the theme's `--hero-padding` accounts for: the sunset's light
 * bands and blinds stay within its bottom 58px.
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
