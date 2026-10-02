import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { THEMES, type ThemeStructure } from "../../themes/registry";
import { ThemeStructureProvider } from "./ThemeStructureProvider";
import { useThemeDateFormat } from "./useThemeDateFormat";
import { Table } from "../ui/table";
import Loader from "../Loader";
import { MapDrawerSection } from "../routes/MapDrawerSection";
import { LineChart, Line } from "recharts";
import { Slider } from "../ui/slider";
import { YAxisMarker } from "../charts/YAxisMarker";
import { SectionLabel } from "./SectionLabel";
import { Section } from "./Section";
import { Button } from "../ui/button";

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
  it("draws a chaser or a block row, keeping the status role", () => {
    const shapes = (["chaser", "block"] as const).map((loaderStyle) => {
      const { container, unmount } = withStructure({ loaderStyle }, <Loader />);
      screen.getByRole("status");
      const segments = container.querySelectorAll(".loader-segment").length;
      const cursors = container.querySelectorAll(".loader-cursor").length;
      unmount();
      return { loaderStyle, segments, cursors };
    });

    expect(shapes).toEqual([
      { loaderStyle: "chaser", segments: 8, cursors: 0 },
      { loaderStyle: "block", segments: 10, cursors: 1 },
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

describe("sectionLabelMark", () => {
  const marks = (container: HTMLElement) =>
    container.querySelectorAll('[aria-hidden="true"][class*="--label-mark"]').length;

  it("puts a pill before a heading label and a section title, only when the theme asks", () => {
    const tree = (
      <>
        <SectionLabel as="h2">Goals</SectionLabel>
        <Section title="Recent activity">content</Section>
      </>
    );
    const { container: pill } = withStructure({ sectionLabelMark: "pill" }, tree);
    expect(marks(pill)).toBe(2);
    // Hidden from assistive tech: the heading's name is its words alone.
    expect(screen.getByRole("heading", { name: "Goals" })).toBeInTheDocument();

    const { container: none } = withStructure({ sectionLabelMark: "none" }, tree);
    expect(marks(none)).toBe(0);
  });

  it("leaves a span label, a panel's meta, unmarked", () => {
    const { container } = withStructure(
      { sectionLabelMark: "pill" },
      <SectionLabel>Last 4 weeks</SectionLabel>
    );
    expect(marks(container)).toBe(0);
  });
});

describe("buttonOutlineEdge", () => {
  const ringed = (overrides: Partial<ThemeStructure>, node: ReactNode) => {
    const { unmount } = withStructure(overrides, node);
    const result = screen.getByRole("button").classList.contains("button-outline-edge");
    unmount();
    return result;
  };

  it("rings an outline button only where the theme draws a gradient edge", () => {
    const outline = <Button variant="outline">Load more</Button>;
    expect(ringed({ buttonOutlineEdge: "gradient" }, outline)).toBe(true);
    expect(ringed({ buttonOutlineEdge: "border" }, outline)).toBe(false);
  });

  it("leaves a joined stepper button and other variants plain", () => {
    const gradient = { buttonOutlineEdge: "gradient" } as const;
    expect(
      ringed(
        gradient,
        <Button variant="outline" joined>
          +
        </Button>
      )
    ).toBe(false);
    expect(ringed(gradient, <Button variant="ghost">Reset</Button>)).toBe(false);
  });

  it("keeps `joined` off the DOM", () => {
    withStructure(
      {},
      <Button variant="outline" joined>
        −
      </Button>
    );
    expect(screen.getByRole("button")).not.toHaveAttribute("joined");
  });
});
