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
 * Arcade's laser floor: a rainbow grid running to a horizon, drawn entirely in gradients.
 *
 * The plane is a flat box rotated back under the hero. It is stretched well past both edges
 * (`-50%` each side) because perspective fans the far end inward: without the overhang the
 * grid would narrow away from the page edges near the horizon.
 */
const GRID_PLANE_TRANSFORM = "perspective(420px) rotateX(62deg)";

/**
 * The columns. The spacing is a percentage rather than a pixel pitch, so the plane keeps 48
 * columns at every page width and the perspective reads the same on a phone as on a desktop.
 */
const GRID_COLUMNS =
  "linear-gradient(90deg, #ff5f1f 0%, #ff00ff 12%, #b400ff 24%, #0080ff 36%, #00ffff 50%, " +
  "#0080ff 64%, #b400ff 76%, #ff00ff 88%, #ff5f1f 100%)";
const GRID_COLUMN_MASK = "repeating-linear-gradient(90deg, #000 0 2px, transparent 2px 2.0833%)";

/** The cross lines: cyan, then magenta every other rung. */
const GRID_ROWS =
  "repeating-linear-gradient(0deg, rgba(0, 255, 255, 0.6) 0 2px, transparent 2px 30px, " +
  "rgba(255, 0, 255, 0.6) 30px 32px, transparent 32px 60px)";

/** Distance haze: the grid dissolves into the ground rather than ending at an edge. */
const GRID_FADE =
  "linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.9) 28%, rgba(0, 0, 0, 0.45) 58%, transparent 100%)";

const GRID_HORIZON =
  "linear-gradient(90deg, transparent, #ff00ff 30%, #00ffff 50%, #ff00ff 70%, transparent)";
const GRID_GLOW =
  "radial-gradient(ellipse 55% 70% at 50% 100%, rgba(180, 0, 255, 0.22), transparent 70%)";

/**
 * How far up the hero the floor reaches. The hero reserves at least this much bottom padding
 * (`--hero-padding`), so the plane never runs under the headline; the test holds the pair
 * together.
 */
export const GRID_FLOOR_HEIGHT = 176;

/** The floor and its haze, sized to the bottom of the hero band. */
function GridFloor() {
  return (
    <>
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        {/* The plane itself, clipped by the parent so the overhang never widens the page. */}
        <div
          data-decoration="grid-floor"
          className="absolute bottom-0 -left-1/2 -right-1/2 h-[900px] origin-bottom"
          style={{
            transform: GRID_PLANE_TRANSFORM,
            background: GRID_ROWS + ", " + GRID_COLUMNS,
            maskImage: GRID_COLUMN_MASK,
            WebkitMaskImage: GRID_COLUMN_MASK,
            opacity: 0.75,
          }}
        />
        {/* Violet haze where the floor meets the horizon. */}
        <div className="absolute inset-0" style={{ background: GRID_GLOW }} />
        {/* The far edge reads as distance, not as the end of a box. */}
        <div className="absolute inset-x-0 bottom-0 h-[200px]" style={{ background: GRID_FADE }} />
        <div
          data-decoration="grid-horizon"
          className="absolute inset-x-0 bottom-[150px] h-px opacity-70"
          style={{ background: GRID_HORIZON, boxShadow: "0 0 12px rgba(255, 0, 255, 0.7)" }}
        />
      </div>
    </>
  );
}

/**
 * The decoration behind a hero band, per the theme's `heroDecoration`. The recipes are
 * fixed artwork, so they live here rather than in slots. Hero content must clear the
 * bottom of the band, which the theme's `--hero-padding` accounts for: the sunset's light
 * bands and blinds stay within its bottom 58px, and the grid's floor within its bottom 176px.
 *
 * Neither decoration animates, so there is nothing for reduced motion to stop; both are
 * `aria-hidden`, since neither carries information the text does not.
 */
export function HeroDecoration({ kind }: { kind: ThemeStructure["heroDecoration"] }) {
  if (kind === "grid") return <GridFloor />;
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
