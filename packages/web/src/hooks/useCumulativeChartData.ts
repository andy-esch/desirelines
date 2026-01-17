import { useMemo } from "react";
import type { DistanceEntry } from "../types/activity";
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

export function useCumulativeChartData({
  year,
  goals,
  distanceData,
  showFullYear,
  sport,
}: UseCumulativeChartDataProps) {
  // Derive values from distanceData
  const latestDate = useMemo(() => {
    if (distanceData.length === 0) return new Date();
    const lastEntry = distanceData[distanceData.length - 1];
    return new Date(lastEntry?.x || new Date());
  }, [distanceData]);

  const totalDistanceTraveled = useMemo(() => {
    if (distanceData.length === 0) return 0;
    const lastEntry = distanceData[distanceData.length - 1];
    return lastEntry?.y || 0;
  }, [distanceData]);

  const estimatedYearEnd = useMemo(() => {
    if (distanceData.length === 0) return 0;
    return estimateYearEndDistance(distanceData, year);
  }, [distanceData, year]);

  // Calculate year boundaries using UTC to ensure consistent display
  // across timezones (Jan 1 - Dec 31 should show as Jan 1 - Dec 31 everywhere)
  const startDate = useMemo(() => new Date(Date.UTC(year, 0, 1)), [year]);
  const endDate = useMemo(() => new Date(Date.UTC(year, 11, 31)), [year]);

  // Use either full year or current date based on toggle
  const displayEndDate = showFullYear ? endDate : latestDate;

  // Calculate goal lines (must be before early returns per React hooks rules)
  const goalLines = useMemo(
    () =>
      goals.map((goal) => ({
        goal,
        line: calculateDesireLine(goal.value, year, displayEndDate),
      })),
    [goals, year, displayEndDate]
  );

  // Project average line
  const currentAverageLine = useMemo(
    () => calculateCurrentAverageLine(distanceData, year, displayEndDate),
    [distanceData, year, displayEndDate]
  );

  // Detect goal achievements (when actual crosses goal line)
  const goalAchievements = useMemo(() => {
    const achievements: Array<{
      date: Date;
      goalLabel: string;
      goalValue: number;
      actualValue: number;
      goalColor: string;
      goalIndex: number;
    }> = [];

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

  // Merge all data into a single array for Recharts
  // Recharts expects data like: [{ date: ..., actual: ..., goal1: ..., goal2: ..., average: ... }]
  const mergedData = useMemo(() => {
    const dataMap = new Map<number, Record<string, number | Date>>();

    // Add actual distance data
    distanceData.forEach((point) => {
      dataMap.set(new Date(point.x).getTime(), {
        date: new Date(point.x),
        actual: point.y,
      });
    });

    // Add goal lines
    goalLines.forEach((gl, index) => {
      gl.line.forEach((point) => {
        const timestamp = new Date(point.x).getTime();
        const existing = dataMap.get(timestamp) || { date: new Date(point.x) };
        dataMap.set(timestamp, {
          ...existing,
          [`goal${index}`]: point.y,
        });
      });
    });

    // Add average line
    currentAverageLine.forEach((point) => {
      const timestamp = new Date(point.x).getTime();
      const existing = dataMap.get(timestamp) || { date: new Date(point.x) };
      dataMap.set(timestamp, {
        ...existing,
        average: point.y,
      });
    });

    // Convert map to sorted array
    return Array.from(dataMap.values()).sort(
      (a, b) => (a.date as Date).getTime() - (b.date as Date).getTime()
    );
  }, [distanceData, goalLines, currentAverageLine]);

  // Get current values (at the latest date with actual data, not display end date)
  const latestActualData = mergedData.find(
    (d) => d.actual !== undefined && typeof d.actual === "number" && d.actual > 0
  );
  const latestDataIndex =
    distanceData.length > 0
      ? mergedData.findIndex(
          (d) => d.date && new Date(d.date as Date).getTime() === latestDate.getTime()
        )
      : mergedData.length - 1;
  const currentActualData = latestDataIndex >= 0 ? mergedData[latestDataIndex] : latestActualData;

  const currentValues = {
    actual: totalDistanceTraveled, // Use actual distance traveled, not merged data
    goals: goalLines.map((gl, index) => {
      // Get goal value at the latest actual data point
      const goalValue = currentActualData?.[`goal${index}`] as number;
      return {
        label: gl.goal.label,
        value: goalValue || gl.goal.value,
        color: GOAL_COLORS[index % GOAL_COLORS.length],
      };
    }),
    average: (currentActualData?.average as number) || 0,
  };

  // Get sport-specific metric configuration
  const metricConfig = useMemo(() => getMetricConfig(sport || "cycling"), [sport]);

  // Calculate Y-axis ticks based on data range using MetricConfig thresholds
  const yAxisTicks = useMemo(() => {
    const maxValue = Math.max(
      ...mergedData.flatMap(
        (d) =>
          [
            d.actual,
            ...Object.keys(d)
              .filter((k) => k.startsWith("goal"))
              .map((k) => d[k] as number),
            d.average,
          ].filter((v) => v !== undefined) as number[]
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
