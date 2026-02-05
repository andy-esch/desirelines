import { useWeeklySummary } from "../../hooks/useWeeklySummary";
import { formatMetricDisplayValue } from "../../utils/units";

/**
 * Compact card showing this-week totals per sport with prorated weekly goal %.
 *
 * Design:
 * - Sport color dots match sparkline spectrum colors
 * - Weekly goal % shows inline as a badge
 * - Shows "No activity yet this week" if all zeros
 */
export default function WeeklySummaryCard() {
  const { sportTotals, weekLabel, isLoading, error } = useWeeklySummary();

  if (error) {
    return (
      <div className="border rounded p-2 h-100" style={{ background: "transparent" }}>
        <div className="text-center text-muted py-3">
          <small>Unable to load weekly summary</small>
        </div>
      </div>
    );
  }

  const hasAnyActivity = sportTotals.some((s) => s.weeklyTotal > 0);

  // Aggregate totals by type for footer
  const distanceSports = sportTotals.filter((s) => s.isDistanceSport && s.weeklyTotal > 0);
  const sessionsSports = sportTotals.filter((s) => !s.isDistanceSport && s.weeklyTotal > 0);

  const totalDistance = distanceSports.reduce((sum, s) => sum + s.weeklyTotal, 0);
  const totalSessions = sessionsSports.reduce((sum, s) => sum + s.weeklyTotal, 0);
  const distanceUnit = distanceSports[0]?.metricUnit ?? "mi";

  return (
    <div className="border rounded p-2 h-100" style={{ background: "transparent" }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="h6 mb-0 text-muted">This Week</h6>
        <small className="text-muted">{weekLabel}</small>
      </div>
      {isLoading ? (
        <div className="text-center text-muted py-3">
          <small>Loading...</small>
        </div>
      ) : !hasAnyActivity ? (
        <div className="text-center text-muted py-3">
          <small>No activity yet this week</small>
        </div>
      ) : (
        <>
          {sportTotals.map((sport) => (
            <div
              key={sport.sport}
              className="d-flex align-items-center justify-content-between py-1"
              style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}
            >
              <div className="d-flex align-items-center">
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: sport.color,
                    boxShadow: `0 0 3px ${sport.color}`,
                    marginRight: 8,
                    flexShrink: 0,
                  }}
                />
                <span className="small">{sport.displayName}</span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <span className="small fw-medium">
                  {sport.weeklyTotal > 0
                    ? `${formatMetricDisplayValue(sport.weeklyTotal, sport.isDistanceSport)} ${sport.metricUnit}`
                    : "—"}
                </span>
                {sport.weeklyTotal > 0 && (
                  <span
                    className="badge"
                    style={{
                      backgroundColor: getAchievementColor(sport.achievementPct),
                      fontSize: "0.65rem",
                      minWidth: 42,
                    }}
                  >
                    {Math.round(sport.achievementPct)}%
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Footer totals */}
          <div className="pt-2 mt-1">
            <small className="text-muted">
              Total:{" "}
              {totalDistance > 0 && (
                <span>
                  {formatMetricDisplayValue(totalDistance, true)} {distanceUnit}
                </span>
              )}
              {totalDistance > 0 && totalSessions > 0 && ", "}
              {totalSessions > 0 && (
                <span>
                  {totalSessions} session{totalSessions !== 1 ? "s" : ""}
                </span>
              )}
            </small>
          </div>
        </>
      )}
    </div>
  );
}

function getAchievementColor(pct: number): string {
  if (pct >= 100) return "rgba(0, 200, 100, 0.85)";
  if (pct >= 75) return "rgba(0, 180, 200, 0.8)";
  if (pct >= 50) return "rgba(180, 150, 0, 0.8)";
  return "rgba(150, 150, 150, 0.6)";
}
