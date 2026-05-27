/**
 * Chart Test Helpers
 *
 * Mock data generators and test utilities for chart component testing.
 * These helpers create realistic data structures that match what the
 * chart hooks and presenters expect.
 */
import type { DistanceEntry } from "../../types/activity";
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
// Distance Data Generators
// ============================================================================

/**
 * Generate cumulative distance data for a given date range.
 *
 * @param options - Configuration options
 * @returns Array of DistanceEntry points
 */
export function generateDistanceData(options: {
  year: number;
  startDay?: number;
  endDay?: number;
  startValue?: number;
  dailyIncrement?: number;
  variance?: number;
}): DistanceEntry[] {
  const {
    year,
    startDay = 1,
    endDay = 30,
    startValue = 0,
    dailyIncrement = 10,
    variance = 2,
  } = options;

  const data: DistanceEntry[] = [];
  let cumulative = startValue;

  for (let day = startDay; day <= endDay; day++) {
    // Add some randomness
    const dailyAmount = dailyIncrement + (Math.random() - 0.5) * variance * 2;
    cumulative += Math.max(0, dailyAmount);

    const date = new Date(Date.UTC(year, 0, day));
    data.push({
      x: date.toISOString(),
      y: Math.round(cumulative * 10) / 10, // Round to 1 decimal
    });
  }

  return data;
}

/**
 * Generate sample distance data for a specific scenario.
 */
export const sampleDistanceData = {
  /** Minimal data - just 2 points */
  minimal: (): DistanceEntry[] => [
    { x: "2024-01-01T00:00:00Z", y: 10 },
    { x: "2024-01-02T00:00:00Z", y: 20 },
  ],

  /** Typical January data */
  january: (): DistanceEntry[] =>
    generateDistanceData({ year: 2024, startDay: 1, endDay: 31, dailyIncrement: 15 }),

  /** Half-year data */
  halfYear: (): DistanceEntry[] =>
    generateDistanceData({ year: 2024, startDay: 1, endDay: 180, dailyIncrement: 12 }),

  /** Full year of data */
  fullYear: (): DistanceEntry[] =>
    generateDistanceData({ year: 2024, startDay: 1, endDay: 365, dailyIncrement: 10 }),

  /** Empty data */
  empty: (): DistanceEntry[] => [],

  /** Single point */
  single: (): DistanceEntry[] => [{ x: "2024-06-15T00:00:00Z", y: 1500 }],
};

// ============================================================================
// Goal Generators
// ============================================================================

/**
 * Build a chart-shaped goal record (`GoalMeta`).
 *
 * Chart presenters only render the legend-relevant subset of `Goal` — id,
 * value, and label. This helper is *not* a full `Goal` constructor; for that,
 * use `testGoal` from `utils/goalTestFixtures`. Naming this `createGoalMeta`
 * keeps the difference obvious.
 */
export function createGoalMeta(options: { id?: string; value: number; label?: string }) {
  return {
    id: options.id || `goal-${Date.now()}`,
    value: options.value,
    label: options.label || `${options.value} Goal`,
  };
}

/**
 * Sample goal configurations (chart-meta shape).
 */
export const sampleGoals = {
  /** Single goal */
  single: () => [createGoalMeta({ id: "1", value: 3000, label: "Base Goal" })],

  /** Two goals - typical setup */
  dual: () => [
    createGoalMeta({ id: "1", value: 3000, label: "Base Goal" }),
    createGoalMeta({ id: "2", value: 5000, label: "Stretch Goal" }),
  ],

  /** Multiple goals */
  multiple: () => [
    createGoalMeta({ id: "1", value: 2000, label: "Minimum" }),
    createGoalMeta({ id: "2", value: 3000, label: "Target" }),
    createGoalMeta({ id: "3", value: 4000, label: "Stretch" }),
    createGoalMeta({ id: "4", value: 5000, label: "Epic" }),
  ],

  /** No goals */
  empty: () => [],
};

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

/**
 * Sample achievement configurations.
 */
export const sampleAchievements = {
  /** Single achievement */
  single: (year = 2024): GoalAchievement[] => [
    createAchievement({
      date: new Date(Date.UTC(year, 9, 15)), // Oct 15
      goalLabel: "Base Goal",
      goalValue: 3000,
      actualValue: 3050,
      goalIndex: 0,
    }),
  ],

  /** Multiple achievements */
  multiple: (year = 2024): GoalAchievement[] => [
    createAchievement({
      date: new Date(Date.UTC(year, 7, 20)), // Aug 20
      goalLabel: "Base Goal",
      goalValue: 3000,
      actualValue: 3025,
      goalIndex: 0,
    }),
    createAchievement({
      date: new Date(Date.UTC(year, 10, 5)), // Nov 5
      goalLabel: "Stretch Goal",
      goalValue: 5000,
      actualValue: 5100,
      goalIndex: 1,
    }),
  ],

  /** No achievements */
  empty: (): GoalAchievement[] => [],
};
