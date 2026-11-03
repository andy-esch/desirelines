import { useMemo } from "react";
import { useCurrentYear } from "../../hooks/useCurrentYear";
import { useAllGoals } from "../../hooks/useGoals";
import { useSportConfig } from "../../hooks/useSportConfig";
import { useUnitSettings } from "../../hooks/usePreferences";
import { DEMO_SPORT_LABELS, type DemoSport } from "../../constants/demoConfig";
import Loader from "../Loader";
import { ErrorState } from "../ErrorState";
import { Table } from "../ui/table";
import { GOAL_STORAGE_VERSION, type GoalsForYear } from "../../services/userConfigService";
import {
  goalToDisplay,
  legacyGoalToDisplay,
  type GoalUnitContext,
} from "../../utils/goalCalculations";
import { getMetricUnitLabel, type MetricUnit } from "../../utils/units";
import { isTimeSport } from "../../utils/sportConfig";

/** Flattened goal row for display */
interface GoalRow {
  year: number;
  sport: DemoSport;
  sportLabel: string;
  goalId: string;
  label: string;
  /** In the session's units, or as stored when the sport isn't in the sport config. */
  value: number;
  /** The unit `value` is in ("mi", "hrs", "sessions"), or null when it's as stored. */
  unit: string | null;
}

/**
 * Goal management table for Settings page.
 * Displays all goals across all sports and years in a unified view: the account's, or
 * signed out the demo's on this device.
 */
export function GoalManagementTable() {
  const { goalsByYear: goals, loading, error } = useAllGoals();
  const { sportConfig, isLoading: sportConfigLoading } = useSportConfig();
  const { distanceUnit } = useUnitSettings();

  // Flatten goals from nested structure into table rows
  const goalRows = useMemo<GoalRow[]>(() => {
    if (!goals) return [];

    const rows: GoalRow[] = [];

    // Iterate years
    Object.entries(goals).forEach(([yearStr, sportGoalsForYear]) => {
      const year = parseInt(yearStr, 10);
      const data = sportGoalsForYear;
      if (isNaN(year) || !data?.sports) return;

      // Iterate sports
      // The store keeps each section's `storageVersion`, which the generated type leaves out.
      Object.entries<GoalsForYear>(data.sports).forEach(([sport, goalsForYear]) => {
        if (!goalsForYear?.goals) return;

        const sportKey = sport as DemoSport;
        const sportLabel = DEMO_SPORT_LABELS[sportKey] || sport;

        // Goals are stored in meters, minutes or sessions; show them as the sport page
        // does. A sport the config doesn't know keeps its stored value, with no unit.
        const sportInfo = sportConfig?.sportCategories?.[sport];
        const ctx: GoalUnitContext = {
          hasDistance: sportInfo?.hasDistance ?? false,
          isTime: isTimeSport(sport, sportConfig),
          distanceUnit,
        };
        const canonical = goalsForYear.storageVersion === GOAL_STORAGE_VERSION;
        const unit: MetricUnit = ctx.hasDistance ? distanceUnit : ctx.isTime ? "hours" : "sessions";

        // Iterate goals
        goalsForYear.goals.forEach((goal) => {
          let value = goal.value;
          if (sportInfo) {
            value = canonical
              ? goalToDisplay(goal.value, ctx)
              : legacyGoalToDisplay(goal.value, ctx);
          }
          rows.push({
            year,
            sport: sportKey,
            sportLabel,
            goalId: goal.id,
            label: goal.label || "Unnamed",
            value,
            unit: sportInfo ? getMetricUnitLabel(unit) : null,
          });
        });
      });
    });

    // Sort by year (desc), then sport, then value (asc)
    return rows.sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      if (a.sport !== b.sport) return a.sport.localeCompare(b.sport);
      return a.value - b.value;
    });
  }, [goals, sportConfig, distanceUnit]);

  const currentYear = useCurrentYear();

  if (loading || sportConfigLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader />
      </div>
    );
  }

  // With a last good copy to show, the store has already said the sync failed.
  if (error && !goals) {
    return <ErrorState title="Error loading goals">{error.message}</ErrorState>;
  }

  if (goalRows.length === 0) {
    return (
      <div className="text-muted-text py-6">
        No goals found. Create goals on individual sport pages to see them here.
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <th style={{ width: "80px" }}>Year</th>
              <th style={{ width: "100px" }}>Sport</th>
              <th>Label</th>
              <th style={{ width: "120px", textAlign: "right" }}>Target</th>
            </tr>
          </thead>
          <tbody>
            {goalRows.map((row) => {
              const isPastYear = row.year < currentYear;
              return (
                <tr
                  key={`${row.year}-${row.sport}-${row.goalId}`}
                  style={{ opacity: isPastYear ? 0.7 : 1 }}
                >
                  <td>
                    <span className={isPastYear ? "text-muted-text" : ""}>{row.year}</span>
                  </td>
                  <td>{row.sportLabel}</td>
                  <td>{row.label}</td>
                  <td style={{ textAlign: "right" }}>
                    {row.value.toLocaleString()}
                    {row.unit && ` ${row.unit}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      <p className="text-muted-text text-sm mt-6 mb-0">Edit goals directly on each sport page.</p>
    </div>
  );
}
