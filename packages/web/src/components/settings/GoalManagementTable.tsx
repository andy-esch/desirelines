import { useMemo } from "react";
import { useCurrentYear } from "../../hooks/useCurrentYear";
import { useFullUserConfig } from "../../hooks/useUserConfig";
import { DEMO_SPORT_LABELS, type DemoSport } from "../../constants/demoConfig";
import NeonSpinner from "../NeonSpinner";
import { InlineAlert } from "../InlineAlert";
import type { SportGoalsForYear } from "../../services/userConfigService";

/** Flattened goal row for display */
interface GoalRow {
  year: number;
  sport: DemoSport;
  sportLabel: string;
  goalId: string;
  label: string;
  value: number;
}

/**
 * Goal management table for Settings page.
 * Displays all goals across all sports and years in a unified view.
 */
export function GoalManagementTable() {
  const { config, loading, error } = useFullUserConfig();

  // Flatten goals from nested structure into table rows
  const goalRows = useMemo<GoalRow[]>(() => {
    if (!config?.goals) return [];

    const rows: GoalRow[] = [];

    // Iterate years
    Object.entries(config.goals).forEach(([yearStr, sportGoalsForYear]) => {
      const year = parseInt(yearStr, 10);
      const data = sportGoalsForYear as SportGoalsForYear;
      if (isNaN(year) || !data?.sports) return;

      // Iterate sports
      Object.entries(data.sports).forEach(([sport, goalsForYear]) => {
        if (!goalsForYear?.goals) return;

        const sportKey = sport as DemoSport;
        const sportLabel = DEMO_SPORT_LABELS[sportKey] || sport;

        // Iterate goals
        goalsForYear.goals.forEach((goal) => {
          rows.push({
            year,
            sport: sportKey,
            sportLabel,
            goalId: goal.id,
            label: goal.label || "Unnamed",
            value: goal.value,
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
  }, [config?.goals]);

  const currentYear = useCurrentYear();

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-4">
        <NeonSpinner />
      </div>
    );
  }

  if (error) {
    return <InlineAlert>Failed to load goals: {error.message}</InlineAlert>;
  }

  if (goalRows.length === 0) {
    return (
      <div className="text-muted py-3">
        No goals found. Create goals on individual sport pages to see them here.
      </div>
    );
  }

  return (
    <div>
      <div className="table-responsive">
        <table className="table table-sm mb-0">
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
                    <span className={isPastYear ? "text-muted" : ""}>{row.year}</span>
                  </td>
                  <td>{row.sportLabel}</td>
                  <td>{row.label}</td>
                  <td style={{ textAlign: "right" }}>{row.value.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-muted small mt-3 mb-0">Edit goals directly on each sport page.</p>
    </div>
  );
}
