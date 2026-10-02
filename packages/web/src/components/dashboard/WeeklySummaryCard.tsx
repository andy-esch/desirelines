import { useWeeklySummary } from "../../hooks/useWeeklySummary";
import { formatMetricDisplayValue, formatHoursMinutes } from "../../utils/units";
import Skeleton, { SkeletonRegion } from "../Skeleton";
import { ErrorState } from "../ErrorState";
import { StatusSymbol, type GoalStatus } from "../theme/StatusSymbol";
import { Panel } from "../theme/Panel";
import { MissingValue } from "../theme/MissingValue";

/**
 * Compact card showing this-week totals per sport with prorated weekly goal %.
 *
 * Design:
 * - Sport color dots match sparkline spectrum colors
 * - Weekly goal % shows inline as the theme's status symbol, for a sport with a goal; the
 *   goals card beside it says where to set one
 * - Shows "No activity yet this week" if all zeros
 */
export default function WeeklySummaryCard() {
  const { sportTotals, weekLabel, isLoading, error, retry } = useWeeklySummary();

  if (error) {
    return (
      <Panel className="h-full" bodyClassName="p-4" title="This Week" tone="danger">
        <ErrorState title="Error loading weekly summary" onRetry={retry}>
          {error.message}
        </ErrorState>
      </Panel>
    );
  }

  const hasAnyActivity = sportTotals.some((s) => s.weeklyTotal > 0);

  // Aggregate totals by type for footer
  const distanceSports = sportTotals.filter(
    (s) => s.metricType === "distance" && s.weeklyTotal > 0
  );
  const timeSports = sportTotals.filter((s) => s.metricType === "time" && s.weeklyTotal > 0);
  const sessionSports = sportTotals.filter((s) => s.metricType === "sessions" && s.weeklyTotal > 0);

  const totalDistance = distanceSports.reduce((sum, s) => sum + s.weeklyTotal, 0);
  const totalTime = timeSports.reduce((sum, s) => sum + s.weeklyTotal, 0);
  const totalSessions = sessionSports.reduce((sum, s) => sum + s.weeklyTotal, 0);
  const distanceUnit = distanceSports[0]?.metricUnit ?? "mi";

  return (
    <Panel className="h-full" bodyClassName="p-2" title="This Week" meta={weekLabel}>
      {isLoading ? (
        <SkeletonRegion label="Loading weekly summary">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1"
              style={{ borderBottom: "1px solid var(--color-surface-border)" }}
            >
              <div className="flex items-center gap-2">
                <Skeleton circle height={8} width={8} />
                <Skeleton width={60} height={14} />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton width={50} height={14} />
                <Skeleton width={36} height={16} borderRadius={10} />
              </div>
            </div>
          ))}
        </SkeletonRegion>
      ) : !hasAnyActivity ? (
        <div className="text-center text-muted-text py-6">
          <small>No activity yet this week</small>
        </div>
      ) : (
        <>
          {sportTotals.map((sport) => (
            <div
              key={sport.sport}
              className="flex items-center justify-between py-(--row-padding)"
              style={{ borderBottom: "1px solid var(--color-surface-border)" }}
            >
              <div className="flex items-center">
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: sport.color,
                    boxShadow: `0 0 0 1px var(--color-chart-mark-outline), 0 0 3px ${sport.color}`,
                    marginRight: 8,
                    flexShrink: 0,
                  }}
                />
                <span className="text-sm">{sport.displayName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {sport.weeklyTotal > 0 ? (
                    formatMetricDisplayValue(sport.weeklyTotal, sport.metricType, sport.metricUnit)
                  ) : (
                    <MissingValue />
                  )}
                </span>
                {sport.weeklyTotal === 0 && (
                  <StatusSymbol status="no-activity" label="No activity" />
                )}
                {sport.weeklyTotal > 0 && sport.hasGoal && (
                  <StatusSymbol
                    status={getAchievementStatus(sport.achievementPct)}
                    label={`${Math.round(sport.achievementPct)}% of goal`}
                  />
                )}
              </div>
            </div>
          ))}

          {/* Footer totals */}
          <div className="flex items-baseline justify-between gap-4 pt-2 mt-1">
            <span className="text-(length:--label-size) font-(weight:--label-weight) tracking-(--label-tracking) [text-transform:var(--label-case)] text-(color:--color-muted-text)">
              Total
            </span>
            <small className="text-muted-text">
              {totalDistance > 0 && (
                <span>{formatMetricDisplayValue(totalDistance, "distance", distanceUnit)}</span>
              )}
              {totalDistance > 0 && (totalTime > 0 || totalSessions > 0) && ", "}
              {totalTime > 0 && <span>{formatHoursMinutes(totalTime)}</span>}
              {totalTime > 0 && totalSessions > 0 && ", "}
              {totalSessions > 0 && (
                <span>
                  {Math.round(totalSessions)} session{Math.round(totalSessions) !== 1 ? "s" : ""}
                </span>
              )}
            </small>
          </div>
        </>
      )}
    </Panel>
  );
}

/** Weekly progress as a goal status. */
function getAchievementStatus(pct: number): GoalStatus {
  if (pct >= 100) return "ahead";
  if (pct >= 75) return "on-track";
  if (pct >= 50) return "slightly-behind";
  return "behind";
}
