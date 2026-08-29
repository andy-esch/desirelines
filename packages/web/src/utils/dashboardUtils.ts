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
import { SPORT_COLORS, DEFAULT_SPORT_COLOR } from "../utils/sportConfig";

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
 * 5. Attaches the sport's fixed identity color from `SPORT_COLORS`.
 */
export function transformToSportGoalData(options: TransformOptions): SportGoalData {
  const { sport, metrics, goalsData, demoGoals, sportConfig, userSettings, isAuthMode } = options;

  const metricConfig = getMetricConfig(sport, sportConfig);
  const primaryMetric = getPrimaryMetric(sport, sportConfig);
  const metricCfg = getMetricConfigByMetricId(primaryMetric, userSettings);
  const fieldName = getMetricFieldName(primaryMetric);
  const isDistance = primaryMetric === "distance_meters";
  const isTime = primaryMetric === "time_minutes";

  // --- 1. Current YTD Value ---
  let currentValue = 0;
  const lastEntry = metrics?.at(-1);
  if (lastEntry) {
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

  // One conversion rule for both goals: the target and the impact goal were
  // each running their own copy of this isDistance/isTime/else chain, so a
  // change to how goals are displayed had to be made in two places.
  const goalToDisplayValue = (value: number): number => {
    if (isDistance) return goalMetersToDisplay(value, userSettings.distanceUnit);
    if (isTime) return minutesToHours(value);
    return value;
  };

  if (isAuthMode && goalsData?.goals?.length) {
    const goalValue = getTargetGoalValue(goalsData.goals);
    if (goalValue !== null) {
      targetGoal = goalToDisplayValue(goalValue);
    }
    // Find the smallest goal for impact calculations
    const minGoal = goalsData.goals.reduce((min, g) => (g.value < min.value ? g : min));
    impactGoal = goalToDisplayValue(minGoal.value);
    impactGoalLabel = minGoal.label ?? "";
  } else if (!isAuthMode && demoGoals) {
    targetGoal = demoGoals.target;
    impactGoal = demoGoals.conservative;
    impactGoalLabel = "Conservative";
  }

  return {
    sport,
    displayName: getSportDisplayName(sport, sportConfig),
    color: SPORT_COLORS[sport] ?? DEFAULT_SPORT_COLOR,
    currentValue,
    targetGoal,
    metricUnit: metricCfg.chartLabel,
    metricType: isDistance ? "distance" : isTime ? "time" : "sessions",
    impactGoal,
    impactGoalLabel,
  };
}
