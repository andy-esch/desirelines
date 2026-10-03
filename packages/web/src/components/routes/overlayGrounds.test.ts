import { describe, it, expect } from "vitest";

/**
 * Text that floats over the routes map, or over the Charts page as it scrolls, sits on a
 * solid ground.
 *
 * A pill can't know what is behind it. With a see-through fill (`bg-surface-raised/85`), a
 * bright patch of basemap or a neon route pulled small muted text as low as 1.3:1 (Miami's
 * map loading label). Solid, each one's contrast is a pair the theme contract measures:
 * muted, subtle, body and accent text on `--color-surface-raised` and `--color-bg-body`.
 */
const sources = import.meta.glob<string>(
  [
    "./RouteMap.tsx",
    "./MapLoadingState.tsx",
    "../../pages/RoutesPage.tsx",
    "../ActiveFilterPill.tsx",
  ],
  { query: "?raw", eager: true, import: "default" }
);

/** A background color with an opacity modifier, e.g. `bg-card/90`. */
const SEE_THROUGH_FILL = /\bbg-[\w-]+\/\d+/g;

describe("overlay grounds", () => {
  it("are solid wherever text sits on them", () => {
    const fills = Object.entries(sources).flatMap(([path, text]) =>
      [...text.matchAll(SEE_THROUGH_FILL)].map(([fill]) => `${path}: ${fill}`)
    );

    // The map's failure veil is the one exception: its copy sits in an opaque danger panel.
    expect(fills).toEqual(["./RouteMap.tsx: bg-bg-body/90"]);
  });

  it("is looking at the files it names", () => {
    // A path that matches nothing would make the check above pass for the wrong reason.
    expect(Object.keys(sources)).toHaveLength(4);
  });
});
