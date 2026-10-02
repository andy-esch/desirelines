/**
 * The lines the cumulative and pacing charts draw, each described once: its data key, the
 * name the legend and the tooltip give it, and its stroke. A chart draws its `<Line>`s and
 * its legend swatches from the same description, so the two can't drift apart, and the
 * tooltip reads the names off the lines.
 *
 * The data keys are the chart hooks' (`useCumulativeChartData`, `usePacingChartData`):
 * `actual`, `goal0`… in goal order, `average`, `dangerBoundary` and `prior_<year>`.
 */
import { CHART_COLORS, GOAL_COLORS, priorYearStroke } from "../../constants/chartColors";
import { CHART_CONFIG } from "../../constants/chartConfig";
import type { LegendItem } from "./ChartLegend";

export interface ChartLine {
  dataKey: string;
  /** What the legend and the tooltip call the line, e.g. "Target 4,000". */
  name: string;
  stroke: string;
  width: number;
  dash?: string | undefined;
}

/** The year's own line. */
export const ACTUAL_LINE: ChartLine = {
  dataKey: "actual",
  name: "Actual",
  stroke: CHART_COLORS.ACTUAL_DATA_LINE,
  width: CHART_CONFIG.strokeWidth.actual,
};

/** A goal's line: named for the goal and the total it aims for, "Target 4,000". */
export function goalLine(goal: { label: string; value: number }, index: number): ChartLine {
  return {
    dataKey: `goal${index}`,
    name: `${goal.label || "Goal"} ${Math.round(goal.value).toLocaleString()}`,
    stroke: GOAL_COLORS[index % GOAL_COLORS.length]!,
    width: CHART_CONFIG.strokeWidth.goal,
  };
}

/**
 * A prior year's ghost line, under the year's at a finer width and fading with each year
 * back (see `priorYearStroke`).
 */
export function priorYearLine(
  { year, dataKey }: { year: number; dataKey: string },
  yearsBack: number
): ChartLine {
  return { dataKey, name: String(year), stroke: priorYearStroke(yearsBack), width: 1.5 };
}

/** A `<Line>`'s data key, name and stroke props for a line. */
export function lineProps({ dataKey, name, stroke, width, dash }: ChartLine) {
  return {
    dataKey,
    name,
    stroke,
    strokeWidth: width,
    ...(dash === undefined ? {} : { strokeDasharray: dash }),
  };
}

/** A line's legend entry: its name, by a swatch drawn as the line is. */
export function legendItem({ name, stroke, width, dash }: ChartLine): LegendItem {
  return { label: name, swatch: { stroke, width, dash } };
}
