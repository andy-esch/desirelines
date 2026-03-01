import type { MetricsEntry } from "../api/activities";
import type { SportConfig } from "../api/activities";
import type { GoalsForYear } from "../types/generated/user_config";
import type { UserSettings } from "../utils/units";
import {
  getMetricConfig,
  getMetricConfigByMetricId,
  getMetricFieldName,
} from "../config/metricConfig";
import { getSportDisplayName, getPrimaryMetric } from "../utils/sportConfig";
import { getTargetGoalValue } from "../utils/goalCalculations";
import {
  convertDistance,
  goalMetersToDisplay,
  minutesToHours,
  type MetricType,
} from "../utils/units";
import { getSpectrumColor } from "../utils/chartColors";

export interface SportGoalData {
  sport: string;
  displayName: string;
  color: string;
  currentValue: number;
  targetGoal: number;
  metricUnit: string;
  metricType: MetricType;
  /** Smallest (least conservative) goal value in display units, for impact calculations */
  impactGoal: number;
  /** Label of the smallest goal (e.g. "Conservative") */
  impactGoalLabel: string;
}

interface TransformOptions {
  sport: string;
  index: number;
  totalSports: number;
  metrics: MetricsEntry[] | undefined;
  goalsData: GoalsForYear | null | undefined;
  demoGoals: { conservative: number; target: number; stretch: number } | undefined;
  sportConfig: SportConfig | null;
  userSettings: UserSettings;
  isAuthMode: boolean;
}

/**
 * Pure utility to transform raw API/Demo data into the SportGoalData format used by the UI.
 *
 * Logic Breakdown:
 * 1. Identifies the primary metric for the sport (distance vs time vs sessions).
 * 2. Calculates the current YTD value from the metrics timeseries.
 * 3. Determines the target goal value (prioritizing user-set goals over defaults).
 * 4. Calculates the "impact goal" (most conservative goal) for status indicators.
 * 5. Assigns spectrum-based colors based on the sport's position.
 */
export function transformToSportGoalData(options: TransformOptions): SportGoalData {
  const {
    sport,
    index,
    totalSports,
    metrics,
    goalsData,
    demoGoals,
    sportConfig,
    userSettings,
    isAuthMode,
  } = options;

  const metricConfig = getMetricConfig(sport);
  const primaryMetric = getPrimaryMetric(sport, sportConfig);
  const metricCfg = getMetricConfigByMetricId(primaryMetric, userSettings);
  const fieldName = getMetricFieldName(primaryMetric);
  const isDistance = primaryMetric === "distance_meters";
  const isTime = primaryMetric === "time_minutes";

  // --- 1. Current YTD Value ---
  let currentValue = 0;
  if (metrics && metrics.length > 0) {
    const lastEntry = metrics[metrics.length - 1];
    const rawValue = lastEntry[fieldName] ?? 0;
    if (isDistance) {
      currentValue = convertDistance(rawValue, userSettings.distanceUnit);
    } else if (isTime) {
      currentValue = minutesToHours(rawValue);
    } else {
      currentValue = rawValue;
    }
  }

  // --- 2. Target & Impact Goals ---
  let targetGoal = metricConfig.defaultGoalValue;
  let impactGoal = targetGoal;
  let impactGoalLabel = "";

  if (isAuthMode && goalsData?.goals?.length) {
    const goalValue = getTargetGoalValue(goalsData.goals);
    if (goalValue !== null) {
      if (isDistance) {
        targetGoal = goalMetersToDisplay(goalValue, userSettings.distanceUnit);
      } else if (isTime) {
        targetGoal = minutesToHours(goalValue);
      } else {
        targetGoal = goalValue;
      }
    }
    // Find the smallest goal for impact calculations
    const minGoal = goalsData.goals.reduce((min, g) => (g.value < min.value ? g : min));
    if (isDistance) {
      impactGoal = goalMetersToDisplay(minGoal.value, userSettings.distanceUnit);
    } else if (isTime) {
      impactGoal = minutesToHours(minGoal.value);
    } else {
      impactGoal = minGoal.value;
    }
    impactGoalLabel = minGoal.label ?? "";
  } else if (!isAuthMode && demoGoals) {
    targetGoal = demoGoals.target;
    impactGoal = demoGoals.conservative;
    impactGoalLabel = "Conservative";
  }

  return {
    sport,
    displayName: getSportDisplayName(sport, sportConfig),
    color: getSpectrumColor(index, totalSports),
    currentValue,
    targetGoal,
    metricUnit: metricCfg.chartLabel,
    metricType: isDistance ? "distance" : isTime ? "time" : "sessions",
    impactGoal,
    impactGoalLabel,
  };
}
