import { useMemo } from "react";
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

interface UseCumulativeChartDataProps {
  year: number;
  goals: Goals;
  distanceData: DistanceEntry[];
  showFullYear: boolean;
  sport?: string;
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
 * Optimizes performance by memoizing heavy calculations.
 */
export function useCumulativeChartData({
  year,
  goals,
  distanceData,
  showFullYear,
  sport = "cycling",
}: UseCumulativeChartDataProps) {
  // 1. Grouped date range calculations
  const { startDate, latestDate, displayEndDate } = useMemo(() => {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31));
    const latest =
      distanceData.length === 0 ? new Date() : new Date(distanceData[distanceData.length - 1].x);

    return {
      startDate: start,
      latestDate: latest,
      displayEndDate: showFullYear ? end : latest,
    };
  }, [year, distanceData, showFullYear]);

  // 2. Grouped metric calculations
  const { totalDistanceTraveled, estimatedYearEnd } = useMemo(() => {
    return {
      totalDistanceTraveled:
        distanceData.length === 0 ? 0 : distanceData[distanceData.length - 1].y,
      estimatedYearEnd: distanceData.length === 0 ? 0 : estimateYearEndDistance(distanceData, year),
    };
  }, [distanceData, year]);

  // 3. Grouped chart line projections
  const { goalLines, currentAverageLine } = useMemo(() => {
    const lines: GoalLineData[] = goals.map((goal) => ({
      goal,
      line: calculateDesireLine(goal.value, year, displayEndDate),
    }));
    return {
      goalLines: lines,
      currentAverageLine: calculateCurrentAverageLine(distanceData, year, displayEndDate),
    };
  }, [goals, year, displayEndDate, distanceData]);

  // 4. Detect goal achievements (when actual crosses goal line)
  const goalAchievements: GoalAchievement[] = useMemo(() => {
    const achievements: GoalAchievement[] = [];

    goalLines.forEach((gl, index) => {
      // Find first point where actual distance exceeds goal
      for (let i = 1; i < distanceData.length; i++) {
        const prevActual = distanceData[i - 1].y;
        const currActual = distanceData[i].y;
        const goalValue = gl.goal.value;

        // Check if we crossed the goal line (from below to above)
        if (prevActual < goalValue && currActual >= goalValue) {
          achievements.push({
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

    return achievements;
  }, [distanceData, goalLines]);

  // 5. Merge all data into a single array for Recharts
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

    // Convert map to sorted array
    return Array.from(dataMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [distanceData, goalLines, currentAverageLine]);

  // 6. Calculate current summary values
  const currentValues: CurrentChartValues = useMemo(() => {
    const latestActualData = mergedData.find(
      (d) => d.actual !== undefined && typeof d.actual === "number" && d.actual > 0
    );
    const latestDataIndex =
      distanceData.length > 0
        ? mergedData.findIndex((d) => d.date.getTime() === latestDate.getTime())
        : mergedData.length - 1;
    const currentActualData = latestDataIndex >= 0 ? mergedData[latestDataIndex] : latestActualData;

    return {
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
  }, [mergedData, distanceData, latestDate, totalDistanceTraveled, goalLines]);

  // 7. Metric-specific UI configuration
  const metricConfig = useMemo(() => getMetricConfig(sport), [sport]);

  const yAxisTicks = useMemo(() => {
    const maxValue = Math.max(
      ...mergedData.flatMap((d) =>
        [
          d.actual,
          ...Object.keys(d)
            .filter((k) => k.startsWith("goal"))
            .map((k) => d[k as keyof CumulativeChartDataPoint] as number),
          d.average,
        ].filter((v): v is number => v !== undefined)
      )
    );

    return generateYAxisTicks(maxValue, metricConfig);
  }, [mergedData, metricConfig]);

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
  };
}
