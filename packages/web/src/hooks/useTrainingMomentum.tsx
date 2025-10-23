import React, { useMemo } from "react";
import type { DistanceEntry } from "../types/activity";
import {
  calculateTrainingMomentum,
  getMomentumLevel,
  type MomentumLevel,
} from "../utils/trainingMomentum";
import { isActivityDataStale } from "../utils/activityStatus";

export interface TrainingMomentumResult {
  /** Training momentum as percentage change per week (null if insufficient data) */
  trainingMomentum: number | null;
  /** Whether activity data is stale (>7 days since last activity) */
  isDataStale: boolean;
  /** Categorized momentum level */
  momentumLevel: MomentumLevel;
  /** Rendered momentum indicator component */
  momentumIndicator: React.ReactElement | null;
}

/**
 * Custom hook for calculating and displaying training momentum
 *
 * Encapsulates the logic for:
 * - Calculating 14-day pacing trend (linear regression)
 * - Detecting stale activity data
 * - Categorizing momentum into discrete levels
 * - Rendering the momentum indicator with tooltip
 *
 * @param distanceData - Array of distance data points
 * @param averagePace - Current average daily pace
 * @returns Training momentum statistics and indicator component
 *
 * @example
 * const { trainingMomentum, momentumIndicator } = useTrainingMomentum(distanceData, 8.3);
 */
export function useTrainingMomentum(
  distanceData: DistanceEntry[],
  averagePace: number
): TrainingMomentumResult {
  // Training momentum calculation: 14-day pacing slope
  const trainingMomentum = useMemo(
    () => calculateTrainingMomentum(distanceData, averagePace),
    [distanceData, averagePace]
  );

  // Check if activity data is stale (no recent activities)
  const isDataStale = useMemo(() => isActivityDataStale(distanceData), [distanceData]);

  // Categorize training momentum into 5 levels
  const momentumLevel: MomentumLevel = useMemo(
    () => getMomentumLevel(trainingMomentum, isDataStale),
    [trainingMomentum, isDataStale]
  );

  // Training momentum indicator renderer
  const momentumIndicator = useMemo(() => {
    if (!momentumLevel) return null;

    const getSymbol = () => {
      if (momentumLevel === "stale") return "✕";
      if (momentumLevel === "significantly-up" || momentumLevel === "up") return "↑";
      if (momentumLevel === "steady") return "─";
      return "↓";
    };

    const getDescription = () => {
      if (momentumLevel === "stale") {
        return "Training Momentum: No recent activity\n\nNo activity recorded in the last 7 days. Momentum indicator is not available.";
      }

      if (trainingMomentum === null) return "";

      const sign = trainingMomentum >= 0 ? "+" : "";
      const percentage = `${sign}${trainingMomentum.toFixed(1)}%`;

      let trend = "";
      if (momentumLevel === "significantly-up") trend = "Significantly ramping up";
      else if (momentumLevel === "up") trend = "Ramping up";
      else if (momentumLevel === "steady") trend = "Steady pace";
      else if (momentumLevel === "down") trend = "Slightly declining";
      else if (momentumLevel === "significantly-down") trend = "Declining";

      return `Training Momentum: ${trend}\n${percentage} per week (14-day trend)\n\nShows whether your daily pace is accelerating, steady, or slowing down over the last 2 weeks.`;
    };

    return (
      <span
        style={{
          color: "#888",
          fontSize: "0.9em",
          marginLeft: "4px",
          cursor: "help",
          textDecoration: "underline dotted",
        }}
        title={getDescription()}
      >
        {getSymbol()}
      </span>
    );
  }, [momentumLevel, trainingMomentum]);

  return {
    trainingMomentum,
    isDataStale,
    momentumLevel,
    momentumIndicator,
  };
}
