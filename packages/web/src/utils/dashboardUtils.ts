import type { MetricsEntry } from "../api/activities";
import type { SportConfig } from "../api/activities";
import type { GoalsForYear } from "../types/generated/user_config";
import type { UserSettings } from "../utils/units";
import { getMetricConfigByMetricId, getMetricFieldName } from "../config/metricConfig";
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
  /**
   * Whether there's a goal to measure against: one the athlete saved for the sport and year,
   * or the demo's. Without one, `targetGoal` and `impactGoal` are 0, never a default the
   * athlete didn't choose, and the dashboard says "No goal".
   */
  hasGoal: boolean;
  /** The target goal in display units; 0 without a goal. */
  targetGoal: number;
  metricUnit: string;
  metricType: MetricType;
  /** Smallest (least conservative) goal value in display units, for impact calculations; 0 without a goal. */
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
 * 3. Determines the target goal value from the athlete's saved goals, or the demo's.
 * 4. Calculates the "impact goal" (most conservative goal) for status indicators.
 *    Without goals, both are 0 and `hasGoal` is false.
 * 5. Attaches the sport's fixed identity color from `SPORT_COLORS`.
 */
export function transformToSportGoalData(options: TransformOptions): SportGoalData {
  const { sport, metrics, goalsData, demoGoals, sportConfig, userSettings, isAuthMode } = options;

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
  // Zero until a goal sets them. A default here would be measured against as if the
  // athlete had chosen it: a percentage in the Impact column, a pace on the goals card.
  let hasGoal = false;
  let targetGoal = 0;
  let impactGoal = 0;
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
    hasGoal = true;
    const goalValue = getTargetGoalValue(goalsData.goals);
    if (goalValue !== null) {
      targetGoal = goalToDisplayValue(goalValue);
    }
    // Find the smallest goal for impact calculations
    const minGoal = goalsData.goals.reduce((min, g) => (g.value < min.value ? g : min));
    impactGoal = goalToDisplayValue(minGoal.value);
    impactGoalLabel = minGoal.label ?? "";
  } else if (!isAuthMode && demoGoals) {
    hasGoal = true;
    targetGoal = demoGoals.target;
    impactGoal = demoGoals.conservative;
    impactGoalLabel = "Conservative";
  }

  return {
    sport,
    displayName: getSportDisplayName(sport, sportConfig),
    color: SPORT_COLORS[sport] ?? DEFAULT_SPORT_COLOR,
    currentValue,
    hasGoal,
    targetGoal,
    metricUnit: metricCfg.chartLabel,
    metricType: isDistance ? "distance" : isTime ? "time" : "sessions",
    impactGoal,
    impactGoalLabel,
  };
}
