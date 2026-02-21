/**
 * Date convention: All dates in the chart pipeline use UTC timestamps.
 *
 * The API returns dates as "YYYY-MM-DD" strings from `start_date_local` —
 * these are already in the athlete's local timezone (from Strava).
 * JavaScript's `new Date("2025-01-15")` parses date-only strings as UTC midnight,
 * which preserves the calendar date. We use `Date.UTC()` for all computed
 * boundaries (year start/end, goal lines) to stay consistent.
 *
 * All formatters (axis ticks, tooltips) must use `timeZone: "UTC"` to read
 * back the correct calendar date from these timestamps.
 */
import { useMemo } from "react";

const MS_PER_DAY = 86400000;

import type { DistanceEntry } from "../types/activity";
import type {
  CumulativeChartDataPoint,
  CurrentChartValues,
  GoalLineData,
  GoalAchievement,
} from "../types/chartData";
import type { Goals } from "../utils/goalCalculations";
import {
  calculateDesireLine,
  calculateCurrentAverageLine,
  estimateYearEndDistance,
} from "../utils/goalCalculations";
import { getMetricConfig, generateYAxisTicks } from "../config/metricConfig";
import { GOAL_COLORS } from "../constants/chartColors";
import { getCurrentLocalDate } from "../utils/dateUtils";
import { useDangerThresholds } from "./useDangerThresholds";

/** Metadata for a prior year ghost line. */
export interface PriorYearLine {
  year: number;
  dataKey: string;
}

interface UseCumulativeChartDataProps {
  year: number;
  goals: Goals;
  distanceData: DistanceEntry[];
  showFullYear: boolean;
  sport?: string;
  priorYearData?: Record<number, DistanceEntry[]>;
}

/**
 * Align entries from a source year to a target year by mapping month/day.
 * Feb 29 in a leap year is clamped to Feb 28 when the target is non-leap.
 */
function alignToYear(entries: DistanceEntry[], targetYear: number): DistanceEntry[] {
  return entries.map((entry) => {
    const d = new Date(entry.x);
    const month = d.getUTCMonth();
    let day = d.getUTCDate();

    // Clamp Feb 29 → Feb 28 for non-leap target years
    if (month === 1 && day === 29) {
      const feb28 = new Date(Date.UTC(targetYear, 1, 29));
      if (feb28.getUTCMonth() !== 1) {
        day = 28;
      }
    }

    return { x: new Date(Date.UTC(targetYear, month, day)).toISOString(), y: entry.y };
  });
}

/**
 * Hook for calculating cumulative chart data.
 *
 * Transforms raw distance entries into chart-ready data:
 * - Calculates cumulative totals
 * - Projects goal lines and average lines
 * - Identifies goal achievements
 * - Formats data for Recharts
 *
 * Memoization strategy (React Compiler hybrid):
 *
 * Cheap derivations (steps 1-4, 6-7) are left unmemoized — the React Compiler
 * can auto-memoize these when inputs are stable, and the cost of re-running
 * them is negligible.
 *
 * Expensive O(N) computations (steps 5, 8) retain explicit useMemo because:
 *   1. They iterate the full dataset (Map build, sort, flatMap + Math.max).
 *   2. Inputs like `distanceData` and `goals` often arrive as new array
 *      references from TanStack Query, so the compiler cannot guarantee
 *      stability — explicit memos act as a safety net.
 *   3. The merged data feeds multiple downstream consumers; re-computing
 *      it unnecessarily would cascade into wasted work.
 */
export function useCumulativeChartData({
  year,
  goals,
  distanceData,
  showFullYear,
  sport = "cycling",
  priorYearData,
}: UseCumulativeChartDataProps) {
  // 1. Date range calculations
  const startDate = new Date(Date.UTC(year, 0, 1));
  const endDate = new Date(Date.UTC(year, 11, 31));
  const latestDate =
    distanceData.length === 0
      ? getCurrentLocalDate()
      : new Date(distanceData[distanceData.length - 1].x);
  const displayEndDate = showFullYear ? endDate : latestDate;

  // 2. Metric calculations
  const totalDistanceTraveled =
    distanceData.length === 0 ? 0 : distanceData[distanceData.length - 1].y;
  const estimatedYearEnd =
    distanceData.length === 0 ? 0 : estimateYearEndDistance(distanceData, year);

  // 3. Danger zone boundary (max achievable if sustaining danger-threshold pace)
  const { getThreshold } = useDangerThresholds();
  const dangerThreshold = getThreshold(sport);

  // 3. Chart line projections
  const goalLines: GoalLineData[] = goals.map((goal) => ({
    goal,
    line: calculateDesireLine(goal.value, year, displayEndDate),
  }));
  const currentAverageLine = calculateCurrentAverageLine(distanceData, year, displayEndDate);

  // 4. Detect goal achievements (when actual crosses goal line)
  const goalAchievements: GoalAchievement[] = [];
  goalLines.forEach((gl, index) => {
    // Find first point where actual distance exceeds goal
    for (let i = 1; i < distanceData.length; i++) {
      const prevActual = distanceData[i - 1].y;
      const currActual = distanceData[i].y;
      const goalValue = gl.goal.value;

      // Check if we crossed the goal line (from below to above)
      if (prevActual < goalValue && currActual >= goalValue) {
        goalAchievements.push({
          date: new Date(distanceData[i].x),
          goalLabel: gl.goal.label || "Goal",
          goalValue: goalValue,
          actualValue: currActual,
          goalColor: GOAL_COLORS[index % GOAL_COLORS.length],
          goalIndex: index,
        });
        break; // Only track first achievement of each goal
      }
    }
  });

  // 5. Merge all data into a single array for Recharts
  // Explicit useMemo: O(N) Map build + sort over every data series. See header comment.
  const mergedData: CumulativeChartDataPoint[] = useMemo(() => {
    const dataMap = new Map<number, CumulativeChartDataPoint>();

    // Add actual distance data
    distanceData.forEach((point) => {
      const date = new Date(point.x);
      dataMap.set(date.getTime(), {
        date,
        actual: point.y,
      });
    });

    // Add goal lines
    goalLines.forEach((gl, index) => {
      gl.line.forEach((point) => {
        const date = new Date(point.x);
        const timestamp = date.getTime();
        const existing = dataMap.get(timestamp) || { date };
        dataMap.set(timestamp, {
          ...existing,
          [`goal${index}`]: point.y,
        });
      });
    });

    // Add average line
    currentAverageLine.forEach((point) => {
      const date = new Date(point.x);
      const timestamp = date.getTime();
      const existing = dataMap.get(timestamp) || { date };
      dataMap.set(timestamp, {
        ...existing,
        average: point.y,
      });
    });

    // Add danger boundary line (max achievable at danger-threshold pace)
    if (dangerThreshold !== Infinity && distanceData.length > 0) {
      const todayTs = latestDate.getTime();
      const endTs = endDate.getTime();
      const msPerDay = MS_PER_DAY;

      // Generate daily points from today to year end
      for (let ts = todayTs; ts <= endTs; ts += msPerDay) {
        const daysFromToday = (ts - todayTs) / msPerDay;
        const boundaryValue = totalDistanceTraveled + dangerThreshold * daysFromToday;
        const date = new Date(ts);
        const existing = dataMap.get(ts) || { date };
        dataMap.set(ts, { ...existing, dangerBoundary: boundaryValue });
      }
    }

    // Add prior year data (aligned to current year)
    if (priorYearData) {
      for (const [yearStr, entries] of Object.entries(priorYearData)) {
        const priorYear = Number(yearStr);
        const dataKey = `prior_${priorYear}` as const;
        const aligned = alignToYear(entries, year);
        aligned.forEach((point) => {
          const date = new Date(point.x);
          const timestamp = date.getTime();
          const existing = dataMap.get(timestamp) || { date };
          dataMap.set(timestamp, {
            ...existing,
            [dataKey]: point.y,
          });
        });
      }
    }

    // Convert map to sorted array
    return Array.from(dataMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [distanceData, goalLines, currentAverageLine, priorYearData, year]);

  // 6. Calculate current summary values
  const latestActualData = mergedData.find(
    (d) => d.actual !== undefined && typeof d.actual === "number" && d.actual > 0
  );
  const latestDataIndex =
    distanceData.length > 0
      ? mergedData.findIndex((d) => d.date.getTime() === latestDate.getTime())
      : mergedData.length - 1;
  const currentActualData = latestDataIndex >= 0 ? mergedData[latestDataIndex] : latestActualData;

  const currentValues: CurrentChartValues = {
    actual: totalDistanceTraveled,
    goals: goalLines.map((gl, index) => {
      const goalValue = currentActualData?.[`goal${index}`];
      return {
        label: gl.goal.label,
        value: typeof goalValue === "number" ? goalValue : gl.goal.value,
        color: GOAL_COLORS[index % GOAL_COLORS.length],
      };
    }),
    average: currentActualData?.average || 0,
  };

  // 7. Build prior year line metadata (sorted most recent first)
  const priorYearLines: PriorYearLine[] = priorYearData
    ? Object.keys(priorYearData)
        .map(Number)
        .sort((a, b) => b - a)
        .map((y) => ({ year: y, dataKey: `prior_${y}` }))
    : [];

  // 8. Metric-specific UI configuration
  const metricConfig = getMetricConfig(sport);

  // Explicit useMemo: flatMap over full merged dataset + Math.max. See header comment.
  const yAxisTicks = useMemo(() => {
    const allValues = mergedData.flatMap((d) =>
      [
        d.actual,
        ...Object.keys(d)
          .filter((k) => k.startsWith("goal") || k.startsWith("prior_"))
          .map((k) => d[k as keyof CumulativeChartDataPoint] as number),
        d.average,
      ].filter((v): v is number => v !== undefined)
    );

    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    return generateYAxisTicks(maxValue, metricConfig);
  }, [mergedData, metricConfig]);

  // 9. Danger zone adaptive visibility
  // Show the boundary line only when at least one goal requires exceeding
  // the danger-threshold pace from today to year end.
  const shouldShowDangerZone = (() => {
    if (dangerThreshold === Infinity || distanceData.length === 0) return false;
    const todayTs = latestDate.getTime();
    const endTs = endDate.getTime();
    const daysRemaining = (endTs - todayTs) / MS_PER_DAY;
    if (daysRemaining <= 0) return false;
    const maxAchievable = totalDistanceTraveled + dangerThreshold * daysRemaining;
    return goals.some((g) => g.value > maxAchievable);
  })();

  return {
    latestDate,
    totalDistanceTraveled,
    estimatedYearEnd,
    startDate,
    displayEndDate,
    goalLines,
    currentAverageLine,
    goalAchievements,
    mergedData,
    currentValues,
    yAxisTicks,
    priorYearLines,
    dangerThreshold,
    shouldShowDangerZone,
  };
}
