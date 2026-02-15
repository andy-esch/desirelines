import type { CSSProperties } from "react";
import { useWeeklySummary } from "../../hooks/useWeeklySummary";
import { formatMetricDisplayValue } from "../../utils/units";
import Skeleton from "../Skeleton";

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
      <div className="glass-panel h-full">
        <div className="text-center text-slate-light py-6">
          <small>Unable to load weekly summary</small>
        </div>
      </div>
    );
  }

  const hasAnyActivity = sportTotals.some((s) => s.weeklyTotal > 0);

  // Aggregate totals by type for footer
  const distanceSports = sportTotals.filter((s) => s.isDistanceSport && s.weeklyTotal > 0);
  const timeSports = sportTotals.filter(
    (s) => !s.isDistanceSport && s.metricUnit === "hrs" && s.weeklyTotal > 0
  );
  const sessionSports = sportTotals.filter(
    (s) => !s.isDistanceSport && s.metricUnit !== "hrs" && s.weeklyTotal > 0
  );

  const totalDistance = distanceSports.reduce((sum, s) => sum + s.weeklyTotal, 0);
  const totalTime = timeSports.reduce((sum, s) => sum + s.weeklyTotal, 0);
  const totalSessions = sessionSports.reduce((sum, s) => sum + s.weeklyTotal, 0);
  const distanceUnit = distanceSports[0]?.metricUnit ?? "mi";

  return (
    <div className="glass-panel h-full">
      <div className="flex justify-between items-center mb-2">
        <h6 className="h6 mb-0 text-slate-light">This Week</h6>
        <small className="text-slate-light">{weekLabel}</small>
      </div>
      {isLoading ? (
        <div role="status" aria-label="Loading weekly summary">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1"
              style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}
            >
              <div className="flex items-center gap-2">
                <Skeleton circle height={8} width={8} dualTheme={0} />
                <Skeleton width={60} height={14} dualTheme={0} />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton width={50} height={14} dualTheme={0} />
                <Skeleton width={36} height={16} borderRadius={10} dualTheme={0} />
              </div>
            </div>
          ))}
        </div>
      ) : !hasAnyActivity ? (
        <div className="text-center text-slate-light py-6">
          <small>No activity yet this week</small>
        </div>
      ) : (
        <>
          {sportTotals.map((sport) => (
            <div
              key={sport.sport}
              className="flex items-center justify-between py-1"
              style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}
            >
              <div className="flex items-center">
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
                <span className="text-sm">{sport.displayName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {sport.weeklyTotal > 0
                    ? `${formatMetricDisplayValue(sport.weeklyTotal, sport.isDistanceSport)} ${sport.metricUnit}`
                    : "—"}
                </span>
                {sport.weeklyTotal > 0 && (
                  <span
                    className="badge"
                    style={{
                      ...getAchievementStyle(sport.achievementPct),
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
            <small className="text-slate-light">
              Total:{" "}
              {totalDistance > 0 && (
                <span>
                  {formatMetricDisplayValue(totalDistance, true)} {distanceUnit}
                </span>
              )}
              {totalDistance > 0 && (totalTime > 0 || totalSessions > 0) && ", "}
              {totalTime > 0 && <span>{totalTime.toFixed(1)} hrs</span>}
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
    </div>
  );
}

/**
 * NEON-themed achievement badge styles.
 * Uses the app's NEON color palette with characteristic glow effects.
 */
function getAchievementStyle(pct: number): CSSProperties {
  // >= 100%: Neon green (goal achieved)
  if (pct >= 100) {
    return {
      backgroundColor: "rgba(0, 255, 128, 0.9)",
      color: "#1a202c",
      boxShadow: "0 0 6px rgba(0, 255, 128, 0.6)",
    };
  }
  // >= 75%: Electric cyan (on track)
  if (pct >= 75) {
    return {
      backgroundColor: "rgba(0, 212, 255, 0.85)",
      color: "#1a202c",
      boxShadow: "0 0 5px rgba(0, 212, 255, 0.5)",
    };
  }
  // >= 50%: Neon yellow-orange (halfway)
  if (pct >= 50) {
    return {
      backgroundColor: "rgba(255, 200, 0, 0.85)",
      color: "#1a202c",
      boxShadow: "0 0 4px rgba(255, 200, 0, 0.4)",
    };
  }
  // < 50%: Muted magenta (behind)
  return {
    backgroundColor: "rgba(180, 0, 255, 0.5)",
    color: "#fff",
    boxShadow: "0 0 3px rgba(180, 0, 255, 0.3)",
  };
}
