import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { sportChipClass, sportChipStyle } from "./sportChip";
import { SPORT_COLORS } from "../utils/sportConfig";
import { readableInk } from "../utils/colorTokens";
import { THEME_FILES, resolveVars, themeToken } from "../test/themeCss";
import { composite, contrastBetween, parseRgba, type Rgba } from "../test/contrast";

describe("sportChipClass", () => {
  it("keeps the sport chip's own pressed look over the toggle item's", () => {
    // A chip is a toggle item, so its classes merge with the item's; the chip's fill, ink,
    // border and glows win over the theme's pressed-toggle ones rather than haloing the
    // sport color.
    render(
      <ToggleGroup defaultValue={["ride"]} aria-label="Sports">
        <ToggleGroupItem value="ride" className={sportChipClass}>
          Ride
        </ToggleGroupItem>
      </ToggleGroup>
    );
    const classes = screen.getByRole("button", { name: "Ride" }).className.split(/\s+/);

    expect(classes).toEqual(
      expect.arrayContaining([
        "h-(--chip-height)",
        "data-[pressed]:bg-[color-mix(in_srgb,var(--chip)_var(--chip-selected-fill-strength),transparent)]",
        "data-[pressed]:text-[color-mix(in_srgb,var(--chip)_var(--chip-selected-label-strength),var(--chip-selected-ink,var(--chip-ink,var(--color-on-accent))))]",
        "data-[pressed]:border-[color-mix(in_srgb,var(--chip)_calc(100%_-_var(--chip-selected-fill-strength)),var(--color-chart-mark-outline))]",
        "data-[pressed]:inset-shadow-[0_0_var(--chip-selected-inset-glow-size)_color-mix(in_srgb,var(--chip)_var(--chip-selected-glow-strength),transparent)]",
        "data-[pressed]:[text-shadow:none]",
      ])
    );
    expect(classes.filter((c) => c.includes("toggle-pressed"))).toEqual([]);
  });
});

describe("sportChipStyle", () => {
  it("sets the sport color and the ink that reads on it", () => {
    expect(sportChipStyle(SPORT_COLORS.cycling!)).toEqual({
      "--chip": "rgb(255, 0, 255)",
      "--chip-ink": "#000000",
    });
    expect(sportChipStyle(SPORT_COLORS.watersports!)).toEqual({
      "--chip": "rgb(138, 20, 255)",
      "--chip-ink": "#ffffff",
    });
  });

  it("leaves the ink to the CSS fallback for a color it can't read", () => {
    expect(sportChipStyle("var(--color-neon-cyan)")).toEqual({
      "--chip": "var(--color-neon-cyan)",
    });
  });

  it("inks every sport black except watersports, the inventory's map", () => {
    const white = Object.entries(SPORT_COLORS)
      .filter(([, color]) => readableInk(color) === "#ffffff")
      .map(([sport]) => sport);
    expect(white).toEqual(["watersports"]);
  });
});

/**
 * A selected chip's label, measured in each theme for every sport on each surface chips sit
 * on (the page and the routes-map drawer): the ink with the theme's label strength of sport
 * color mixed in, on the sport fill at the theme's fill strength.
 */
describe("a selected chip's label", () => {
  const EXEMPT: Readonly<Record<string, string>> = {
    "legacy-light":
      "predates the contrast pairs (its accent ink on watersports is 3.2:1); it is retired with Electric",
  };
  const percent = (themeId: string, slot: string) => parseFloat(themeToken(themeId, slot)) / 100;
  const color = (value: string): Rgba => {
    const rgba = parseRgba(value);
    if (!rgba) throw new Error(`can't measure ${value}`);
    return rgba;
  };
  const mix = (a: Rgba, b: Rgba, share: number): Rgba => ({
    r: a.r * share + b.r * (1 - share),
    g: a.g * share + b.g * (1 - share),
    b: a.b * share + b.b * (1 - share),
    a: 1,
  });

  const measured = [...THEME_FILES.keys()]
    .filter((id) => !(id in EXEMPT))
    .flatMap((id) => {
      const fill = percent(id, "--chip-selected-fill-strength");
      const label = percent(id, "--chip-selected-label-strength");
      const themeInk = themeToken(id, "--chip-selected-ink");
      return ["--color-bg-body", "--map-chrome-bg"].flatMap((surface) => {
        const ground = color(resolveVars(id, themeToken(id, surface)));
        return Object.entries(SPORT_COLORS).map(([sport, value]) => {
          const sportColor = color(value);
          const ink = color(
            themeInk === "initial" ? readableInk(value)! : resolveVars(id, themeInk)
          );
          const chip = composite({ ...sportColor, a: fill }, ground);
          const ratio = contrastBetween(mix(sportColor, ink, label), chip);
          return { key: `${id} ${sport} on ${surface}`, ratio };
        });
      });
    });

  it("clears 4.5:1 for every sport in every theme not exempt", () => {
    expect(measured.length).toBeGreaterThan(0);
    expect(
      measured
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ key, ratio }) => `${key}: ${ratio.toFixed(2)}`)
    ).toEqual([]);
  });

  it("names only themes that exist as exempt", () => {
    expect(Object.keys(EXEMPT).filter((id) => !THEME_FILES.has(id))).toEqual([]);
  });
});
