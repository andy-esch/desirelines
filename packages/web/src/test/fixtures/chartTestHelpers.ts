/**
 * Chart Test Helpers
 *
 * Props for the chart presenters' tests, shaped as the chart hooks hand them over, the
 * achievement markers the cumulative chart stars, and readers for what the charts draw.
 */
import type {
  CumulativeChartDataPoint,
  PacingChartDataPoint,
  CurrentChartValues,
  GoalLineData,
  PacingGoalData,
  GoalAchievement,
} from "../../types/chartData";
import { GOAL_COLORS } from "../../constants/chartColors";

// ============================================================================
// Presenter Props Generators
// ============================================================================

/**
 * Generate mock props for CumulativeChartPresenter.
 */
export function createCumulativePresenterProps(
  overrides?: Partial<{
    mergedData: CumulativeChartDataPoint[];
    goalLines: GoalLineData[];
    goalAchievements: GoalAchievement[];
    currentValues: CurrentChartValues;
    startDate: Date;
    displayEndDate: Date;
    yAxisTicks: number[];
    year: number;
    unitLabel: string;
    totalDistanceTraveled: number;
    estimatedYearEnd: number;
    isSessionsMode: boolean;
    showAchievements: boolean;
  }>
) {
  const year = overrides?.year ?? 2024;
  const startDate = overrides?.startDate ?? new Date(Date.UTC(year, 0, 1));
  const displayEndDate = overrides?.displayEndDate ?? new Date(Date.UTC(year, 11, 31));

  const defaultMergedData: CumulativeChartDataPoint[] = [
    { date: new Date(Date.UTC(year, 0, 1)), actual: 10, goal0: 8, goal1: 14, average: 12 },
    { date: new Date(Date.UTC(year, 0, 15)), actual: 150, goal0: 123, goal1: 205, average: 180 },
    { date: new Date(Date.UTC(year, 0, 31)), actual: 310, goal0: 255, goal1: 425, average: 372 },
  ];

  const defaultGoalLines: GoalLineData[] = [
    { goal: { id: "1", value: 3000, label: "Base" }, line: [] },
    { goal: { id: "2", value: 5000, label: "Stretch" }, line: [] },
  ];

  const defaultCurrentValues: CurrentChartValues = {
    actual: 310,
    goals: [
      { label: "Base", value: 255, color: GOAL_COLORS[0] },
      { label: "Stretch", value: 425, color: GOAL_COLORS[1] },
    ],
    average: 372,
  };

  return {
    mergedData: overrides?.mergedData ?? defaultMergedData,
    goalLines: overrides?.goalLines ?? defaultGoalLines,
    goalAchievements: overrides?.goalAchievements ?? [],
    currentValues: overrides?.currentValues ?? defaultCurrentValues,
    startDate,
    displayEndDate,
    yAxisTicks: overrides?.yAxisTicks ?? [0, 1000, 2000, 3000, 4000, 5000],
    year,
    unitLabel: overrides?.unitLabel ?? "mi",
    totalDistanceTraveled: overrides?.totalDistanceTraveled ?? 310,
    estimatedYearEnd: overrides?.estimatedYearEnd ?? 3720,
    isSessionsMode: overrides?.isSessionsMode ?? false,
    showAchievements: overrides?.showAchievements ?? true,
  };
}

/**
 * Generate mock props for PacingChartPresenter.
 */
export function createPacingPresenterProps(
  overrides?: Partial<{
    mergedData: PacingChartDataPoint[];
    pacingGoals: PacingGoalData[];
    currentValues: CurrentChartValues;
    startDate: Date;
    displayEndDate: Date;
    naturalYMax: number;
    year: number;
    unitLabel: string;
    isSessionsMode: boolean;
    dangerZone: { show: boolean; threshold: number; yMax: number };
  }>
) {
  const year = overrides?.year ?? 2024;
  const startDate = overrides?.startDate ?? new Date(Date.UTC(year, 0, 1));
  const displayEndDate = overrides?.displayEndDate ?? new Date(Date.UTC(year, 11, 31));

  const defaultMergedData: PacingChartDataPoint[] = [
    { date: new Date(Date.UTC(year, 0, 1)), actual: 10, goal0: 8.2, goal1: 13.7 },
    { date: new Date(Date.UTC(year, 0, 15)), actual: 9.5, goal0: 8.0, goal1: 13.5 },
    { date: new Date(Date.UTC(year, 0, 31)), actual: 10.2, goal0: 7.8, goal1: 13.3 },
  ];

  const defaultPacingGoals: PacingGoalData[] = [
    { goal: { id: "1", value: 3000, label: "Base" }, pacing: [] },
    { goal: { id: "2", value: 5000, label: "Stretch" }, pacing: [] },
  ];

  const defaultCurrentValues: CurrentChartValues = {
    actual: 10.2,
    goals: [
      { label: "Base", value: 7.8, color: GOAL_COLORS[0] },
      { label: "Stretch", value: 13.3, color: GOAL_COLORS[1] },
    ],
  };

  return {
    mergedData: overrides?.mergedData ?? defaultMergedData,
    pacingGoals: overrides?.pacingGoals ?? defaultPacingGoals,
    currentValues: overrides?.currentValues ?? defaultCurrentValues,
    startDate,
    displayEndDate,
    naturalYMax: overrides?.naturalYMax ?? 33,
    year,
    unitLabel: overrides?.unitLabel ?? "mi",
    isSessionsMode: overrides?.isSessionsMode ?? false,
    dangerZone: overrides?.dangerZone ?? { show: true, threshold: 25, yMax: 33 },
  };
}

// ============================================================================
// Achievement Generators
// ============================================================================

/**
 * Create a goal achievement marker.
 */
export function createAchievement(options: {
  date: Date;
  goalLabel: string;
  goalValue: number;
  actualValue: number;
  goalIndex?: number;
}): GoalAchievement {
  const { date, goalLabel, goalValue, actualValue, goalIndex = 0 } = options;
  return {
    date,
    goalLabel,
    goalValue,
    actualValue,
    goalColor: GOAL_COLORS[goalIndex % GOAL_COLORS.length] ?? "",
    goalIndex,
  };
}

// ============================================================================
// What a drawn chart shows
// ============================================================================

/** Each line in drawing order: its stroke as drawn, and its path (empty with no points). */
export function linesIn(container: HTMLElement) {
  return [...container.querySelectorAll(".recharts-line")].map((line) => {
    const path = line.querySelector("path.recharts-curve");
    return {
      stroke: path?.getAttribute("stroke") ?? null,
      width: path?.getAttribute("stroke-width") ?? null,
      dash: path?.getAttribute("stroke-dasharray") ?? null,
      path: path?.getAttribute("d") ?? "",
    };
  });
}

/** The labels on the y axis that mark where each line sits today. */
export function markersIn(container: HTMLElement) {
  return [...container.querySelectorAll(".recharts-reference-line")]
    .map((marker) => marker.textContent)
    .filter(Boolean);
}

/**
 * The legend row's entries: each label, and its swatch's line as drawn (for the danger zone,
 * the dashed edge over its hatch, whose fill is `hatch`).
 */
export function legendIn(container: HTMLElement) {
  const items = container.querySelectorAll('ul[aria-label="Legend"] > li');
  return [...items].map((item) => {
    const line = item.querySelector(":scope > svg > line");
    return {
      label: item.textContent,
      stroke: line?.getAttribute("stroke") ?? null,
      width: line?.getAttribute("stroke-width") ?? null,
      dash: line?.getAttribute("stroke-dasharray") ?? null,
      hatch: item.querySelector(":scope > svg > rect")?.getAttribute("fill") ?? null,
    };
  });
}

interface DrawnStroke {
  stroke: string | null;
  width: string | null;
  dash: string | null;
}

/** A line's or a swatch's stroke, width and dash, to compare one with the other. */
export const strokeOf = ({ stroke, width, dash }: DrawnStroke): DrawnStroke => ({
  stroke,
  width,
  dash,
});
