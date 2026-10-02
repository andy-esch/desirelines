import { cloneElement, type ReactElement } from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PacingChartPresenter } from "./PacingChartPresenter";
import {
  createPacingPresenterProps,
  legendIn,
  linesIn,
  markersIn,
  strokeOf,
} from "../../test/fixtures/chartTestHelpers";

// jsdom has no layout for ResponsiveContainer to measure, so hand the chart a fixed size the
// way the real container would; without one Recharts draws nothing.
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => (
      <div data-testid="responsive-container" style={{ width: 800, height: 400 }}>
        {cloneElement(children, { width: 800, height: 400 })}
      </div>
    ),
  };
});

type PropOverrides = Parameters<typeof createPacingPresenterProps>[0];

/** Draws the chart from the fixture props, with animation off so lines draw at once. */
function draw(overrides?: PropOverrides) {
  const props = createPacingPresenterProps(overrides);
  return render(<PacingChartPresenter {...props} isAnimationActive={false} />);
}

/** The text labels: the y axis's title, then the danger zone's (the markers draw their own). */
const labelsIn = (container: HTMLElement) =>
  [...container.querySelectorAll(".recharts-label")].map((label) => label.textContent);

/** The y axis's tick labels, bottom to top. */
const yTicksIn = (container: HTMLElement) =>
  [...container.querySelectorAll(".recharts-yAxis-tick-labels text")].map((t) => t.textContent);

/** The danger zone's threshold line: the one dashed reference line. */
const thresholdIn = (container: HTMLElement) =>
  container.querySelector('.recharts-reference-line line[stroke="var(--color-danger-zone)"]');

const ACTUAL = "var(--color-chart-actual-line)";

describe("PacingChartPresenter", () => {
  describe("rendering", () => {
    it("draws the year's pace and each goal's as lines", () => {
      const { container } = draw();
      const lines = linesIn(container);
      expect(lines.map((line) => line.stroke)).toEqual([
        ACTUAL,
        "var(--color-goal-1)",
        "var(--color-goal-2)",
      ]);
      for (const line of lines) expect(line.path).toMatch(/^M/);
    });

    it("marks where the year and each goal's pace sit today on the y axis", () => {
      const { container } = draw();
      expect(markersIn(container)).toEqual(["Actual", "Base", "Stretch"]);
    });

    it("starts the year's line at the axis's left edge for the year shown", () => {
      const { container } = draw({
        year: 2025,
        startDate: new Date(Date.UTC(2025, 0, 1)),
        displayEndDate: new Date(Date.UTC(2025, 11, 31)),
      });
      const plotLeft = container.querySelector(".recharts-xAxis line")?.getAttribute("x1");
      expect(linesIn(container)[0]?.path).toMatch(new RegExp(`^M${plotLeft},`));
    });

    it("marks the first day's pace before there is a line to draw", () => {
      const { container } = draw({
        mergedData: [{ date: new Date(Date.UTC(2024, 0, 1)), actual: 10 }],
        pacingGoals: [],
        currentValues: { actual: 10, goals: [] },
      });
      expect(markersIn(container)).toEqual(["Actual"]);
      expect(linesIn(container).map((line) => line.path)).toEqual([""]);
    });

    // The container shows its empty state instead, so this only proves the chart copes.
    it("draws the axes, and no line or marker, for a year without data", () => {
      const { container } = draw({
        mergedData: [],
        pacingGoals: [],
        currentValues: { actual: 0, goals: [] },
      });
      expect(container.querySelector(".recharts-xAxis")).toBeInTheDocument();
      expect(labelsIn(container)[0]).toBe("mi / Day");
      expect(markersIn(container)).toEqual([]);
      expect(linesIn(container)).toEqual([]);
    });
  });

  describe("units", () => {
    it.each([
      ["mi", "mi / Day"],
      ["km", "km / Day"],
    ])("labels the y axis and the danger zone per day in %s", (unitLabel, axisTitle) => {
      const { container } = draw({ unitLabel });
      expect(labelsIn(container)).toEqual([
        axisTitle,
        `Zone of Unachievability (25.0 ${unitLabel}/day)`,
      ]);
    });

    it("labels the y axis in sessions for a sessions sport", () => {
      const { container } = draw({ isSessionsMode: true, unitLabel: "sessions" });
      expect(labelsIn(container)[0]).toBe("# Sessions / Day");
    });
  });

  describe("danger zone", () => {
    it("draws the threshold as a dashed line, labeled with the pace", () => {
      const { container } = draw({ dangerZone: { show: true, threshold: 25, yMax: 33 } });
      expect(thresholdIn(container)).toHaveAttribute("stroke-dasharray", "5 5");
      expect(labelsIn(container)).toContain("Zone of Unachievability (25.0 mi/day)");
    });

    it("hatches the zone with stripes of the danger color, in a pattern of its own", () => {
      const { container } = draw({ dangerZone: { show: true, threshold: 25, yMax: 33 } });
      const area = container.querySelector(".recharts-reference-area-rect");
      const hatchId = /^url\(#(danger-hatch-[^)]+)\)$/.exec(area?.getAttribute("fill") ?? "")?.[1];
      const stripe = container.querySelector(`.recharts-surface pattern[id="${hatchId}"] rect`);
      expect(stripe).toHaveAttribute("fill", "var(--color-danger-zone)");
      expect(stripe).toHaveAttribute("fill-opacity", "0.3");
      expect(area).toHaveAttribute("fill-opacity", "1");
    });

    it("draws no zone, threshold or label when it is hidden", () => {
      const { container } = draw({ dangerZone: { show: false, threshold: 25, yMax: 33 } });
      expect(linesIn(container)).not.toEqual([]);
      expect(container.querySelector(".recharts-reference-area")).not.toBeInTheDocument();
      expect(thresholdIn(container)).toBeNull();
      expect(labelsIn(container)).toEqual(["mi / Day"]);
    });

    it.each([
      [25, 33],
      [100, 110],
      [5, 10],
    ])(
      "shades from the threshold of %s to the top of an axis running to %s",
      (threshold, naturalYMax) => {
        const { container } = draw({
          naturalYMax,
          dangerZone: { show: true, threshold, yMax: naturalYMax },
        });
        const plotTop = Number(container.querySelector(".recharts-yAxis line")?.getAttribute("y1"));
        const plotBottom = Number(
          container.querySelector(".recharts-yAxis line")?.getAttribute("y2")
        );
        const thresholdY = plotBottom - (threshold / naturalYMax) * (plotBottom - plotTop);

        const area = container.querySelector(".recharts-reference-area-rect");
        expect(Number(area?.getAttribute("y"))).toBeCloseTo(plotTop);
        expect(Number(area?.getAttribute("height"))).toBeCloseTo(thresholdY - plotTop);
        expect(Number(thresholdIn(container)?.getAttribute("y1"))).toBeCloseTo(thresholdY);
      }
    );
  });

  describe("pacing goals", () => {
    it("draws a line and a marker for each of several goals", () => {
      const labels = ["Min", "Target", "Stretch", "Epic"];
      const { container } = draw({
        mergedData: [0, 15, 30].map((day, i) => ({
          date: new Date(Date.UTC(2024, 0, 1 + day)),
          actual: 8.5 + 0.2 * i,
          goal0: 5.5 + 0.1 * i,
          goal1: 8.2 + 0.1 * i,
          goal2: 11 + 0.1 * i,
          goal3: 13.7 + 0.1 * i,
        })),
        pacingGoals: labels.map((label, i) => ({
          goal: { id: String(i), value: 2000 + 1000 * i, label },
          pacing: [],
        })),
        currentValues: {
          actual: 8.9,
          goals: labels.map((label, i) => ({ label, value: 5.7 + 2.7 * i, color: "#00ffff" })),
        },
      });
      const goals = linesIn(container).filter((line) => line.stroke?.includes("--color-goal-"));
      expect(goals.map((line) => line.stroke)).toEqual(
        [1, 2, 3, 4].map((n) => `var(--color-goal-${n})`)
      );
      for (const line of goals) expect(line.path).toMatch(/^M/);
      expect(markersIn(container)).toEqual(["Actual", ...labels]);
    });

    it("draws only the year's pace without goals", () => {
      const { container } = draw({
        pacingGoals: [],
        currentValues: { actual: 10.2, goals: [] },
      });
      expect(linesIn(container).map((line) => line.stroke)).toEqual([ACTUAL]);
      expect(markersIn(container)).toEqual(["Actual"]);
    });
  });

  describe("legend", () => {
    it("names the year, each goal and the danger zone in a row above the chart", () => {
      const { container } = draw();
      expect(legendIn(container).map((item) => item.label)).toEqual([
        "Actual",
        "Base 3,000",
        "Stretch 5,000",
        "Danger zone",
      ]);
    });

    it("draws each line's swatch with the line's own stroke and width", () => {
      const { container } = draw();
      const swatches = legendIn(container).slice(0, 3);
      expect(swatches.map(strokeOf)).toEqual(linesIn(container).map(strokeOf));
    });

    it("hatches the danger zone's swatch as the zone is, under its dashed threshold", () => {
      const { container } = draw();
      const zone = legendIn(container).at(-1);
      const threshold = thresholdIn(container);
      expect(zone?.stroke).toBe(threshold?.getAttribute("stroke"));
      expect(zone?.dash).toBe(threshold?.getAttribute("stroke-dasharray"));
      const swatchHatchId = /^url\(#([^)]+)\)$/.exec(zone?.hatch ?? "")?.[1];
      const stripe = container.querySelector(`ul pattern[id="${swatchHatchId}"] rect`);
      expect(stripe).toHaveAttribute("fill", "var(--color-danger-zone)");
      expect(stripe).toHaveAttribute("fill-opacity", "0.3");
    });

    it("leaves the danger zone out when the chart doesn't draw it", () => {
      const { container } = draw({ dangerZone: { show: false, threshold: 25, yMax: 33 } });
      expect(legendIn(container).map((item) => item.label)).toEqual([
        "Actual",
        "Base 3,000",
        "Stretch 5,000",
      ]);
    });
  });

  describe("Y-axis max", () => {
    it.each([10, 33, 50, 100, 250])("runs the y axis from 0 to a max of %s", (naturalYMax) => {
      const { container } = draw({
        naturalYMax,
        dangerZone: { show: true, threshold: naturalYMax * 0.75, yMax: naturalYMax },
      });
      const ticks = yTicksIn(container);
      expect(ticks[0]).toBe("0.0");
      expect(ticks.at(-1)).toBe(naturalYMax.toFixed(1));
    });

    it("draws the same pace lower on a taller axis", () => {
      const firstY = (naturalYMax: number) => {
        const { container, unmount } = draw({
          naturalYMax,
          dangerZone: { show: false, threshold: 25, yMax: naturalYMax },
        });
        const y = Number(/^M[\d.]+,([\d.]+)/.exec(linesIn(container)[0]?.path ?? "")?.[1]);
        unmount();
        return y;
      };
      expect(firstY(110)).toBeGreaterThan(firstY(33));
    });
  });
});
