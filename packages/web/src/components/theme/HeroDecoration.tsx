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
 * Three layers share one transform: a fill so the floor reads as a surface rather than a
 * hole, the columns, and the cross lines. They are separate elements because only the
 * columns are masked into lanes — masking the whole plane erases the rungs with them, which
 * is what left the first version with nothing running across.
 *
 * The plane is stretched well past both edges (`-50%` each side) because perspective fans
 * the far end inward: without the overhang the grid would narrow away from the page edges
 * near the horizon.
 */
const GRID_PLANE_TRANSFORM = "perspective(360px) rotateX(67deg)";

/** The floor's own surface, darkest at the horizon so the fade has something to sit on. */
const GRID_FILL =
  "linear-gradient(0deg, rgba(180, 0, 255, 0.12) 0%, rgba(74, 0, 110, 0.08) 45%, rgba(10, 0, 20, 0.03) 100%)";

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
 * How far up the hero the floor reaches: the plane's projected height, measured in the
 * browser at the pitch and depth below. Three things hang off it — the distance fade, the
 * horizon line, and the test that keeps the floor inside the hero's bottom padding, which
 * content never enters. Place the horizon by eye instead and it floats above where the grid
 * actually ends, which is how the first version looked wrong.
 */
export const GRID_FLOOR_HEIGHT = 98;

/** The plane's own depth. Shorter than the hero is tall, so the grid lies down rather than
 * standing up: at a steep pitch a long plane pushes its far end well above the horizon. */
const GRID_PLANE_DEPTH = 700;

/** One layer of the floor, sharing the plane's geometry. */
function GridPlane({
  background,
  backgroundSize,
  backgroundPosition,
  mask,
  opacity,
  decoration,
}: {
  background: string;
  /** Set where a gradient should repeat per viewport width rather than span the whole plane. */
  backgroundSize?: string;
  /** Shift a repeating gradient so its middle stop lands at the middle of the screen. */
  backgroundPosition?: string;
  mask?: string;
  opacity: number;
  decoration?: string;
}) {
  return (
    <div
      {...(decoration ? { "data-decoration": decoration } : {})}
      className="absolute bottom-0 -left-1/2 -right-1/2 origin-bottom"
      style={{
        height: GRID_PLANE_DEPTH,
        transform: GRID_PLANE_TRANSFORM,
        background,
        ...(backgroundSize ? { backgroundSize } : {}),
        ...(backgroundPosition ? { backgroundPosition } : {}),
        opacity,
        ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}),
      }}
    />
  );
}

/** The floor and its haze, sized to the bottom of the hero band. */
function GridFloor() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <GridPlane background={GRID_FILL} opacity={1} decoration="grid-fill" />
      <GridPlane
        background={GRID_COLUMNS}
        backgroundSize="50% 100%"
        backgroundPosition="50% 0"
        mask={GRID_COLUMN_MASK}
        opacity={0.75}
        decoration="grid-floor"
      />
      <GridPlane background={GRID_ROWS} opacity={0.75} decoration="grid-rows" />
      {/* Violet haze where the floor meets the horizon. */}
      <div className="absolute inset-0" style={{ background: GRID_GLOW }} />
      {/* The far edge reads as distance, not as the end of a box. */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ height: GRID_FLOOR_HEIGHT, background: GRID_FADE }}
      />
      <div
        data-decoration="grid-horizon"
        className="absolute inset-x-0 h-px opacity-70"
        style={{
          bottom: GRID_FLOOR_HEIGHT,
          background: GRID_HORIZON,
          boxShadow: "0 0 12px rgba(255, 0, 255, 0.7)",
        }}
      />
    </div>
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
