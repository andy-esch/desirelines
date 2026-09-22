import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { THEMES, type ThemeStructure } from "../../themes/registry";
import { ThemeStructureProvider } from "./ThemeStructureProvider";
import { useThemeDateFormat } from "./useThemeDateFormat";
import { Table } from "../ui/table";
import NeonSpinner from "../NeonSpinner";
import { MapDrawerSection } from "../routes/MapDrawerSection";
import { LineChart, Line } from "recharts";
import { Slider } from "../ui/slider";
import { YAxisMarker } from "../charts/YAxisMarker";
import { dangerZoneAreaFill } from "../charts/PacingChartPresenter";

/**
 * One test per structure field that had no reader, so a field going quiet again fails here
 * rather than showing up as a theme that looks wrong. `themeStructure.test.ts` catches a
 * field nothing mentions; these catch a field whose branch stops doing anything.
 */
const base: ThemeStructure = THEMES[0].structure;

function withStructure(overrides: Partial<ThemeStructure>, node: ReactNode) {
  return render(
    <ThemeStructureProvider structure={{ ...base, ...overrides }}>{node}</ThemeStructureProvider>
  );
}

describe("rowHoverCursor", () => {
  it("marks the table so the caret rule applies, and only alongside row hover", () => {
    const { container, rerender } = withStructure(
      { rowHoverCursor: true },
      <Table hover>
        <tbody>
          <tr>
            <td>row</td>
          </tr>
        </tbody>
      </Table>
    );
    expect(container.querySelector("table")).toHaveAttribute("data-row-cursor");

    // A caret without the hover highlight would point at a row nothing is marking.
    rerender(
      <ThemeStructureProvider structure={{ ...base, rowHoverCursor: true }}>
        <Table>
          <tbody>
            <tr>
              <td>row</td>
            </tr>
          </tbody>
        </Table>
      </ThemeStructureProvider>
    );
    expect(container.querySelector("table")).not.toHaveAttribute("data-row-cursor");
  });

  it("leaves the table unmarked when the theme does not ask for a caret", () => {
    const { container } = withStructure(
      { rowHoverCursor: false },
      <Table hover>
        <tbody>
          <tr>
            <td>row</td>
          </tr>
        </tbody>
      </Table>
    );
    expect(container.querySelector("table")).not.toHaveAttribute("data-row-cursor");
  });
});

describe("loaderStyle", () => {
  it("draws a ring, a chaser or a block row, keeping the status role", () => {
    const shapes = (["spinner", "chaser", "block"] as const).map((loaderStyle) => {
      const { container, unmount } = withStructure({ loaderStyle }, <NeonSpinner />);
      const status = screen.getByRole("status");
      const segments = container.querySelectorAll(".loader-segment").length;
      const cursors = container.querySelectorAll(".loader-cursor").length;
      const spins = status.className.includes("animate-spin");
      unmount();
      return { loaderStyle, segments, cursors, spins };
    });

    expect(shapes).toEqual([
      { loaderStyle: "spinner", segments: 0, cursors: 0, spins: true },
      { loaderStyle: "chaser", segments: 8, cursors: 0, spins: false },
      { loaderStyle: "block", segments: 10, cursors: 1, spins: false },
    ]);
  });
});

describe("mapDrawerSections", () => {
  it("separates sections with a rule, or wraps each one in a panel", () => {
    const { container: flat } = withStructure(
      { mapDrawerSections: "flat" },
      <MapDrawerSection>section</MapDrawerSection>
    );
    expect(flat.firstElementChild?.className).toContain("border-t");

    const { container: panels } = withStructure(
      { mapDrawerSections: "panels" },
      <MapDrawerSection>section</MapDrawerSection>
    );
    expect(panels.firstElementChild?.className).not.toContain("border-t");
    expect(panels.firstElementChild?.className).toContain("--panel-accent-1");
  });

  it("gives the first flat section no rule above it", () => {
    const { container } = withStructure(
      { mapDrawerSections: "flat" },
      <MapDrawerSection first>section</MapDrawerSection>
    );
    expect(container.firstElementChild?.className).not.toContain("border-t");
  });
});

describe("dateFormat", () => {
  function DateSample() {
    const { formatDate, formatAxisDate, formatActivityDate } = useThemeDateFormat();
    return (
      <ul>
        <li>{formatDate(new Date(2026, 8, 12), { month: "short", day: "numeric" })}</li>
        <li>{formatAxisDate(Date.UTC(2026, 7, 30))}</li>
        <li>{formatActivityDate("2026-09-12T07:30:00")}</li>
        <li>{formatActivityDate("2026-09-12T07:30:00", { year: true })}</li>
      </ul>
    );
  }

  it("spells dates the short way", () => {
    withStructure({ dateFormat: "short" }, <DateSample />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Sep 12",
      "Aug 30",
      "Sep 12",
      "Sep 12, 2026",
    ]);
  });

  it("spells dates the dotted way, padding only the date parts", () => {
    withStructure({ dateFormat: "dotted" }, <DateSample />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "09.12",
      "08.30",
      "09.12",
      "2026.09.12",
    ]);
  });
});

describe("sliderTrack", () => {
  it("cuts the track and its fill into cells only when the theme asks", () => {
    const { container: segmented } = withStructure(
      { sliderTrack: "segmented" },
      <Slider min={0} max={10} defaultValue={5} />
    );
    // Both halves: masking the track alone would leave a solid fill running over the cells.
    expect(segmented.querySelectorAll(".slider-segmented").length).toBe(2);

    const { container: continuous } = withStructure(
      { sliderTrack: "continuous" },
      <Slider min={0} max={10} defaultValue={5} />
    );
    expect(continuous.querySelectorAll(".slider-segmented").length).toBe(0);
  });
});

describe("chartMarkerShape", () => {
  /** A fixed-size chart, so recharts lays out without a ResponsiveContainer to measure. */
  function markerShapes(shape: ThemeStructure["chartMarkerShape"]) {
    const { container, unmount } = withStructure(
      { chartMarkerShape: shape },
      <LineChart
        width={320}
        height={200}
        data={[
          { x: 1, y: 2 },
          { x: 2, y: 4 },
        ]}
      >
        <Line dataKey="y" dot={false} isAnimationActive={false} />
        <YAxisMarker value={3} label="Actual" color="#fff" />
      </LineChart>
    );
    const result = {
      circles: container.querySelectorAll("circle").length,
      rects: container.querySelectorAll("rect").length,
    };
    unmount();
    return result;
  }

  it("draws the axis marker as a dot or a square", () => {
    const circle = markerShapes("circle");
    const square = markerShapes("square");
    expect(circle.circles).toBeGreaterThan(0);
    expect(square.circles).toBe(0);
    expect(square.rects).toBeGreaterThan(circle.rects);
  });
});

describe("dangerZoneFill", () => {
  it("paints the zone as a wash or as stripes", () => {
    expect(dangerZoneAreaFill("wash", "#f00", 0.08, "hatch-1")).toEqual({
      hatched: false,
      fill: "#f00",
      fillOpacity: 0.08,
    });
    // Full opacity with the pattern: the stripes carry their own transparency, so keeping
    // the wash's 8% would fade them to nothing.
    expect(dangerZoneAreaFill("hatch", "#f00", 0.08, "hatch-1")).toEqual({
      hatched: true,
      fill: "url(#hatch-1)",
      fillOpacity: 1,
    });
  });
});
