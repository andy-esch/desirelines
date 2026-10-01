import { cloneElement, type ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  CumulativeChartPresenter,
  type CumulativeChartPresenterProps,
} from "./CumulativeChartPresenter";
import {
  createAchievement,
  createCumulativePresenterProps,
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

type PropOverrides = Parameters<typeof createCumulativePresenterProps>[0];

/** Draws the chart from the fixture props, with animation off so lines draw at once. */
function draw(overrides?: PropOverrides, extra?: Partial<CumulativeChartPresenterProps>) {
  const props = createCumulativePresenterProps(overrides);
  return render(<CumulativeChartPresenter {...props} isAnimationActive={false} {...extra} />);
}

/** Each line in drawing order: its stroke, and its path (empty when it has no points). */
function linesIn(container: HTMLElement) {
  return [...container.querySelectorAll(".recharts-line")].map((line) => {
    const path = line.querySelector("path.recharts-curve");
    return { stroke: path?.getAttribute("stroke"), path: path?.getAttribute("d") ?? "" };
  });
}

/** The labels on the y axis that mark where each line sits today. */
function markersIn(container: HTMLElement) {
  return [...container.querySelectorAll(".recharts-reference-line")].map((m) => m.textContent);
}

/** The y axis's title, the chart's one text label (the markers draw their own). */
const yAxisLabel = (container: HTMLElement) =>
  container.querySelector(".recharts-label")?.textContent;

const ACTUAL = "var(--color-chart-actual-line)";
const AVERAGE = "var(--color-chart-average-line)";

describe("CumulativeChartPresenter", () => {
  describe("rendering", () => {
    it("draws the year, each goal and the average as lines", () => {
      const { container } = draw();
      const lines = linesIn(container);
      expect(lines.map((line) => line.stroke)).toEqual([
        ACTUAL,
        "var(--color-goal-1)",
        "var(--color-goal-2)",
        AVERAGE,
      ]);
      for (const line of lines) expect(line.path).toMatch(/^M/);
    });

    it("marks where the year and each goal sit today on the y axis", () => {
      const { container } = draw();
      expect(markersIn(container)).toEqual(["Actual", "Base", "Stretch"]);
    });

    it("labels the y axis with the unit", () => {
      const { container } = draw({ unitLabel: "km" });
      expect(yAxisLabel(container)).toBe("km");
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

    it("draws the axes and markers, and no line, for a year without data", () => {
      const { container } = draw({
        mergedData: [],
        goalLines: [],
        goalAchievements: [],
        currentValues: { actual: 0, goals: [] },
      });
      expect(container.querySelector(".recharts-xAxis")).toBeInTheDocument();
      expect(yAxisLabel(container)).toBe("mi");
      expect(markersIn(container)).toEqual(["Actual"]);
      expect(linesIn(container)).toEqual([]);
    });

    it("draws only the year and its average without goals", () => {
      const { container } = draw({
        goalLines: [],
        currentValues: { actual: 310, goals: [] },
      });
      expect(linesIn(container).map((line) => line.stroke)).toEqual([ACTUAL, AVERAGE]);
      expect(markersIn(container)).toEqual(["Actual"]);
    });

    it("labels the y axis in sessions for a sessions sport", () => {
      const { container } = draw({ isSessionsMode: true, unitLabel: "sessions" });
      expect(yAxisLabel(container)).toBe("# Sessions");
    });
  });

  describe("goals", () => {
    it("draws a line and a marker for each of several goals", () => {
      const labels = ["Min", "Target", "Stretch", "Epic"];
      const { container } = draw({
        mergedData: [0, 15, 30].map((day, i) => ({
          date: new Date(Date.UTC(2024, 0, 1 + day)),
          actual: 10 + 150 * i,
          average: 12 + 180 * i,
          goal0: 5 + 80 * i,
          goal1: 8 + 120 * i,
          goal2: 11 + 160 * i,
          goal3: 14 + 200 * i,
        })),
        goalLines: labels.map((label, i) => ({
          goal: { id: String(i), value: 2000 + 1000 * i, label },
          line: [],
        })),
        currentValues: {
          actual: 310,
          goals: labels.map((label, i) => ({ label, value: 165 + 40 * i, color: "#00ffff" })),
        },
      });
      const goals = linesIn(container).filter((line) => line.stroke?.includes("--color-goal-"));
      expect(goals.map((line) => line.stroke)).toEqual(
        [1, 2, 3, 4].map((n) => `var(--color-goal-${n})`)
      );
      for (const line of goals) expect(line.path).toMatch(/^M/);
      expect(markersIn(container)).toEqual(["Actual", ...labels]);
    });
  });

  describe("prior years and the danger zone", () => {
    it("draws a prior year's line behind the year's, in a faded neutral", () => {
      const props = createCumulativePresenterProps();
      const { container } = draw(
        { mergedData: props.mergedData.map((point, i) => ({ ...point, prior_2023: 20 + 90 * i })) },
        { priorYearLines: [{ year: 2023, dataKey: "prior_2023" }] }
      );
      const [prior, actual] = linesIn(container);
      expect(prior?.stroke).toContain("var(--color-chart-neutral)");
      expect(prior?.path).toMatch(/^M/);
      expect(actual?.stroke).toBe(ACTUAL);
    });

    it("draws the most a sustainable pace could reach as a dashed line", () => {
      const props = createCumulativePresenterProps();
      const { container } = draw(
        {
          mergedData: props.mergedData.map((point, i) => ({
            ...point,
            dangerBoundary: 400 + 100 * i,
          })),
        },
        { dangerZone: { show: true, threshold: 25 } }
      );
      const boundary = container.querySelector(
        '.recharts-line path[stroke="var(--color-danger-zone)"]'
      );
      expect(boundary).toHaveAttribute("stroke-dasharray", "5 5");
      expect(boundary?.getAttribute("d")).toMatch(/^M/);
    });
  });

  describe("selection", () => {
    it("shades the range being dragged across", () => {
      const props = createCumulativePresenterProps();
      const { container } = draw(undefined, {
        selectionLeft: props.mergedData[0]!.date.getTime(),
        selectionRight: props.mergedData[2]!.date.getTime(),
      });
      expect(container.querySelector(".recharts-reference-area-rect")).toBeInTheDocument();
    });

    it("shades nothing without a selection", () => {
      const { container } = draw();
      expect(linesIn(container)).not.toEqual([]);
      expect(container.querySelector(".recharts-reference-area")).not.toBeInTheDocument();
    });
  });

  describe("achievements", () => {
    // Inside the fixture's data, which runs to Jan 31 at 310 mi; a star off the axis isn't drawn.
    const reached = [
      createAchievement({
        date: new Date(Date.UTC(2024, 0, 31)),
        goalLabel: "Base",
        goalValue: 300,
        actualValue: 310,
      }),
    ];

    it("stars the day each goal was reached, and lists it in the legend", () => {
      const { container } = draw({ goalAchievements: reached, showAchievements: true });
      const stars = [...container.querySelectorAll(".recharts-reference-dot title")];
      expect(stars.map((title) => title.textContent)).toEqual(["Base achieved! (300 mi)"]);
      expect(screen.getByText("Goals Achieved")).toBeInTheDocument();
    });

    it("draws no stars and no legend when achievements are hidden", () => {
      const { container } = draw({ goalAchievements: reached, showAchievements: false });
      expect(linesIn(container)).not.toEqual([]);
      expect(container.querySelector(".recharts-reference-dot title")).not.toBeInTheDocument();
      expect(screen.queryByText("Goals Achieved")).not.toBeInTheDocument();
    });
  });
});
