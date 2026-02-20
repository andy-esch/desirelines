import { useMemo } from "react";
import type { DistanceEntry } from "../types/activity";
import type { PacingChartDataPoint, CurrentChartValues, PacingGoalData } from "../types/chartData";
import type { Goals } from "../utils/goalCalculations";
import { calculateActualPacing, calculateDynamicPacingGoal } from "../utils/goalCalculations";
import { GOAL_COLORS } from "../constants/chartColors";
import { calculatePacingYAxisMax } from "../utils/chartScaling";
import { useDangerThresholds } from "./useDangerThresholds";

interface UsePacingChartDataProps {
  year: number;
  goals: Goals;
  distanceData: DistanceEntry[];
  showFullYear: boolean;
  sport?: string;
}

/**
 * Hook for calculating pacing chart data.
 *
 * Transforms raw distance entries into pacing chart-ready data:
 * - Calculates daily pacing (distance/day needed to hit goals)
 * - Projects dynamic pacing goal lines
 * - Calculates danger zone thresholds
 * - Formats data for Recharts
 *
 * Optimizes performance by memoizing heavy calculations.
 */
export function usePacingChartData({
  year,
  goals,
  distanceData,
  showFullYear,
  sport = "cycling",
}: UsePacingChartDataProps) {
  const { getThreshold } = useDangerThresholds();

  // 1. Date range calculations
  const { startDate, endDate, latestDate, displayEndDate } = useMemo(() => {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31));
    const latest =
      distanceData.length === 0 ? new Date() : new Date(distanceData[distanceData.length - 1].x);

    return {
      startDate: start,
      endDate: end,
      latestDate: latest,
      displayEndDate: showFullYear ? end : latest,
    };
  }, [year, distanceData, showFullYear]);

  // 2. Calculate actual pacing data
  const actualPacing = useMemo(() => {
    if (distanceData.length === 0) return [];
    return calculateActualPacing(distanceData, displayEndDate);
  }, [distanceData, displayEndDate]);

  // 3. Calculate dynamic pacing goals
  const pacingGoals: PacingGoalData[] = useMemo(
    () =>
      (goals || []).map((goal) => ({
        goal,
        pacing: calculateDynamicPacingGoal(distanceData, goal.value, year, displayEndDate),
      })),
    [goals, distanceData, year, displayEndDate]
  );

  // 4. Merge all pacing data into a single array for Recharts
  const mergedData: PacingChartDataPoint[] = useMemo(() => {
    const dataMap = new Map<number, PacingChartDataPoint>();

    // Add actual pacing data
    actualPacing.forEach((point) => {
      const date = new Date(point.x);
      dataMap.set(date.getTime(), {
        date,
        actual: point.y,
      });
    });

    // Add pacing goal lines
    pacingGoals.forEach((pg, index) => {
      pg.pacing.forEach((point) => {
        const date = new Date(point.x);
        const timestamp = date.getTime();
        const existing = dataMap.get(timestamp) || { date };
        dataMap.set(timestamp, {
          ...existing,
          [`goal${index}`]: point.y,
        });
      });
    });

    // Convert map to sorted array
    return Array.from(dataMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [actualPacing, pacingGoals]);

  // 5. Calculate current values for Y-axis markers
  const currentValues: CurrentChartValues = useMemo(() => {
    // Find the data point at the latest date with actual data
    const latestActualData = mergedData.find(
      (d) => d.actual !== undefined && typeof d.actual === "number" && d.actual > 0
    );
    const latestDataIndex =
      distanceData.length > 0
        ? mergedData.findIndex((d) => d.date.getTime() === latestDate.getTime())
        : mergedData.length - 1;
    const currentActualData = latestDataIndex >= 0 ? mergedData[latestDataIndex] : latestActualData;

    return {
      actual: currentActualData?.actual || 0,
      goals: pacingGoals.map((pg, index) => {
        const goalValue = currentActualData?.[`goal${index}`];
        return {
          label: pg.goal.label,
          value: typeof goalValue === "number" ? goalValue : 0,
          color: GOAL_COLORS[index % GOAL_COLORS.length],
        };
      }),
    };
  }, [mergedData, distanceData, latestDate, pacingGoals]);

  // 6. Danger zone calculations
  const dangerThreshold = useMemo(() => getThreshold(sport), [getThreshold, sport]);

  const naturalYMax = useMemo(() => {
    const maxActualPace = Math.max(...actualPacing.map((p) => p.y), currentValues.actual, 0);
    const maxGoalPace = Math.max(...currentValues.goals.map((g) => g.value), 0);

    return calculatePacingYAxisMax(maxActualPace, maxGoalPace, dangerThreshold);
  }, [actualPacing, currentValues.actual, currentValues.goals, dangerThreshold]);

  const shouldShowDangerZone = useMemo(() => {
    return dangerThreshold <= naturalYMax;
  }, [dangerThreshold, naturalYMax]);

  return {
    // Date range
    startDate,
    endDate,
    latestDate,
    displayEndDate,
    // Pacing data
    actualPacing,
    pacingGoals,
    mergedData,
    currentValues,
    // Danger zone
    dangerThreshold,
    naturalYMax,
    shouldShowDangerZone,
  };
}
