import { Link } from "@tanstack/react-router";
import { useDashboardGoalData, type SportGoalData } from "../../hooks/useDashboardGoalData";
import { PACE_THRESHOLDS } from "../../utils/goalCalculations";
import { formatMetricDisplayValue } from "../../utils/units";
import type { YearContext } from "../../utils/yearContext";
import RaceTrack, { RaceTrackLegend } from "../RaceTrack";
import Skeleton from "../Skeleton";
import { Panel } from "../theme/Panel";
import { Meter } from "../theme/Meter";
import { useThemeStructure } from "../theme/useThemeStructure";

/**
 * Per-sport goal progress. Themes that keep the percent bar (`goalTrackStyle` of
 * `bar-with-percent`) draw the race track; the others draw a goal track with a pace tick.
 *
 * The race track shows two emoji markers racing along a horizontal track:
 * - Dragon (🐲) at your actual progress toward the annual goal
 * - Ghost (👻) at where you'd be if perfectly on pace
 *
 * When ahead of pace, the dragon leads the ghost.
 * When behind, the ghost leads.
 *
 * Features:
 * - Sport name links to detail pages
 * - Status text (Ahead/On Track/Behind) per sport
 * - Metric values below track (current / goal)
 * - Legend explaining the markers
 */
export default function GoalProgressCard() {
  const { sportData, yearContext, isLoading, error } = useDashboardGoalData();
  const { goalTrackStyle } = useThemeStructure();
  const raceTrack = goalTrackStyle === "bar-with-percent";
  const title = `${yearContext.year} Goals`;
  const totalDays = yearContext.daysElapsed + yearContext.daysRemaining;
  const meta = yearContext.shouldShowPacing
    ? `Day ${yearContext.daysElapsed} of ${totalDays}`
    : undefined;

  if (error) {
    return (
      <Panel className="h-full" bodyClassName="p-2" title={title}>
        <div className="text-center text-muted-text py-6">
          <small>Unable to load goal progress</small>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="h-full" bodyClassName="p-2" title={title} meta={meta}>
      {isLoading ? (
        <div role="status" aria-label="Loading goal progress">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mb-2">
              <div className="flex justify-between items-center mb-1">
                <Skeleton width={70} height={14} dualTheme={1} />
                <Skeleton width={90} height={14} dualTheme={1} />
              </div>
              <Skeleton height={28} borderRadius={4} dualTheme={1} />
              <div className="mt-1">
                <Skeleton width={100} height={10} dualTheme={1} />
              </div>
            </div>
          ))}
        </div>
      ) : sportData.length === 0 ? (
        <div className="text-center text-muted-text py-6">
          <small>No sports configured</small>
        </div>
      ) : (
        <>
          {sportData.map((sport) => (
            <SportProgressRow
              key={sport.sport}
              sport={sport}
              yearContext={yearContext}
              raceTrack={raceTrack}
            />
          ))}

          {raceTrack ? (
            <RaceTrackLegend className="pt-2 mt-1" showPace={yearContext.shouldShowPacing} />
          ) : (
            <GoalTrackLegend showPace={yearContext.shouldShowPacing} />
          )}
        </>
      )}
    </Panel>
  );
}

interface SportProgressRowProps {
  sport: SportGoalData;
  yearContext: YearContext;
  /** Draw the emoji race track rather than a goal track with a pace tick. */
  raceTrack: boolean;
}

function SportProgressRow({ sport, yearContext, raceTrack }: SportProgressRowProps) {
  // Calculate positions as percentages
  const youPosition = sport.targetGoal > 0 ? (sport.currentValue / sport.targetGoal) * 100 : 0;

  // Goal pace position: what % of the year has elapsed
  const totalDays = yearContext.daysElapsed + yearContext.daysRemaining;
  const pacePosition = totalDays > 0 ? (yearContext.daysElapsed / totalDays) * 100 : 0;

  const { label: status, delta } = getStatusForDashboard(
    sport.currentValue,
    sport.targetGoal,
    yearContext
  );

  // Natural phrasing: "43.3 mi ahead" / "On track" / "10.8 mi behind"
  let statusDisplay = status;
  if (delta !== null && status !== "On Track") {
    const formatted = formatMetricDisplayValue(Math.abs(delta), sport.metricType, sport.metricUnit);
    const direction = delta >= 0 ? "ahead" : "behind";
    statusDisplay = `${formatted} ${direction}`;
  }

  const current = formatMetricDisplayValue(sport.currentValue, sport.metricType, sport.metricUnit);
  const target = formatMetricDisplayValue(sport.targetGoal, sport.metricType, sport.metricUnit);

  if (!raceTrack) {
    return (
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex justify-between items-baseline gap-3">
          <Link
            to="/$sport/$year"
            params={{ sport: sport.sport, year: String(yearContext.year) }}
            className="text-sm text-body-text"
          >
            {sport.displayName}
          </Link>
          <span className="text-(length:--status-size) tracking-(--status-tracking) [text-transform:var(--status-case)] text-subtle-text">
            {statusDisplay}
          </span>
        </div>
        <Meter
          value={sport.targetGoal > 0 ? sport.currentValue / sport.targetGoal : 0}
          marker={yearContext.shouldShowPacing ? pacePosition / 100 : undefined}
          color={sport.color}
          label={`${sport.displayName} goal progress`}
        />
        <span className="text-xs text-muted-text">
          {current} / {target}
        </span>
      </div>
    );
  }

  return (
    <div className="mb-2">
      <div className="flex justify-between items-center mb-1">
        {/* Neutral label, not the sport color: full-brightness neon as text is
            unreadable on the light ground. The RaceTrack directly below is already
            drawn in `sport.color`, so identity is carried by that mark and the label
            doesn't need to repeat it. `text-body-text` is explicit because the global
            `a` rule would otherwise tint this link accent-cyan. */}
        <Link
          to="/$sport/$year"
          params={{ sport: sport.sport, year: String(yearContext.year) }}
          className="text-sm text-body-text"
        >
          {sport.displayName}
        </Link>
        <span className="text-sm text-muted-text">{statusDisplay}</span>
      </div>

      <RaceTrack
        primaryPosition={youPosition}
        pacePosition={pacePosition}
        showPace={yearContext.shouldShowPacing}
        trackColor={sport.color}
        height={28}
      />

      <div className="text-sm text-muted-text" style={{ fontSize: "0.7rem" }}>
        {current} / {target}
      </div>
    </div>
  );
}

/** Names the goal track's two marks: the progress fill and today's pace tick. */
function GoalTrackLegend({ showPace }: { showPace: boolean }) {
  return (
    <div className="flex gap-5 pt-2 border-t border-dashed border-divider text-(length:--status-size) tracking-(--status-tracking) [text-transform:var(--status-case)] text-muted-text">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-1.5 w-4 rounded-(--track-radius) bg-subtle-text" />
        You
      </span>
      {showPace && (
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3.5 w-(--pace-tick-width) bg-(--color-pace-tick)" />
          Pace today
        </span>
      )}
    </div>
  );
}

interface DashboardStatus {
  label: string;
  /** Delta between current value and prorated goal (positive = ahead, negative = behind). null when no delta applies. */
  delta: number | null;
}

function getStatusForDashboard(
  currentValue: number,
  targetGoal: number,
  yearContext: Pick<YearContext, "daysElapsed" | "daysRemaining" | "isPastYear">
): DashboardStatus {
  const progress = targetGoal > 0 ? (currentValue / targetGoal) * 100 : 0;

  if (yearContext.isPastYear) {
    return { label: progress >= 100 ? "Achieved" : "Not Met", delta: null };
  }

  if (progress >= 100) return { label: "Achieved", delta: null };

  // Calculate pace ratio: actual vs expected at this point
  const totalDays = yearContext.daysElapsed + yearContext.daysRemaining;
  if (totalDays === 0) return { label: "—", delta: null };
  const proratedGoal = targetGoal * (yearContext.daysElapsed / totalDays);
  if (proratedGoal === 0) return { label: currentValue > 0 ? "Ahead" : "—", delta: null };
  const paceRatio = currentValue / proratedGoal;
  const delta = currentValue - proratedGoal;

  if (paceRatio >= PACE_THRESHOLDS.AHEAD) return { label: "Ahead", delta };
  if (paceRatio >= PACE_THRESHOLDS.ON_TRACK) return { label: "On Track", delta };
  if (paceRatio >= PACE_THRESHOLDS.SLIGHTLY_BEHIND) return { label: "Slightly Behind", delta };
  return { label: "Behind", delta };
}
