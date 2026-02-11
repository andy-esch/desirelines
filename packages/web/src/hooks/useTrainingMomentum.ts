import { useMemo } from "react";
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
}

/**
 * Custom hook for calculating training momentum
 *
 * Encapsulates the logic for:
 * - Calculating 14-day pacing trend (linear regression)
 * - Detecting stale activity data
 * - Categorizing momentum into discrete levels
 *
 * Use the returned data with `<MomentumIndicator>` for rendering.
 *
 * @param distanceData - Array of distance data points
 * @param averagePace - Current average daily pace
 * @returns Training momentum statistics
 *
 * @example
 * const { momentumLevel, trainingMomentum } = useTrainingMomentum(distanceData, 8.3);
 * // Render: <MomentumIndicator momentumLevel={momentumLevel} trainingMomentum={trainingMomentum} />
 */
export function useTrainingMomentum(
  distanceData: DistanceEntry[],
  averagePace: number
): TrainingMomentumResult {
  return useMemo(() => {
    const trainingMomentum = calculateTrainingMomentum(distanceData, averagePace);
    const isDataStale = isActivityDataStale(distanceData);
    const momentumLevel = getMomentumLevel(trainingMomentum, isDataStale);

    return { trainingMomentum, isDataStale, momentumLevel };
  }, [distanceData, averagePace]);
}
