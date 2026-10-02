import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useDashboardGoalData, type SportGoalData } from "../../hooks/useDashboardGoalData";
import { PACE_THRESHOLDS } from "../../utils/goalCalculations";
import { formatMetricDisplayValue } from "../../utils/units";
import { getDaysInYear, getYearElapsedShare, type YearContext } from "../../utils/yearContext";
import Skeleton, { SkeletonRegion } from "../Skeleton";
import { ErrorState } from "../ErrorState";
import { Panel } from "../theme/Panel";
import { Meter } from "../theme/Meter";
import { MissingValue } from "../theme/MissingValue";

/**
 * Per-sport goal progress: a goal track filled to your progress, with a tick where an even
 * pace puts you today.
 *
 * Features:
 * - Sport name links to detail pages
 * - Status text (Ahead/On Track/Behind) per sport
 * - Metric values below track (current / goal)
 * - A legend naming the fill and the tick
 * - A sport without a goal says "No goal" and links to its page to set one, with no track
 *   or status: there's nothing to measure against
 */
export default function GoalProgressCard() {
  const { sportData, yearContext, isLoading, error, retry } = useDashboardGoalData();
  const title = `${yearContext.year} Goals`;
  const meta = yearContext.shouldShowPacing
    ? `Day ${yearContext.daysElapsed} of ${getDaysInYear(yearContext.year)}`
    : undefined;

  if (error) {
    return (
      <Panel className="h-full" bodyClassName="p-4" title={title} tone="danger">
        <ErrorState title="Error loading goal progress" onRetry={retry}>
          {error.message}
        </ErrorState>
      </Panel>
    );
  }

  return (
    <Panel className="h-full" bodyClassName="p-2" title={title} meta={meta}>
      {isLoading ? (
        <SkeletonRegion label="Loading goal progress">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mb-2">
              <div className="flex justify-between items-center mb-1">
                <Skeleton width={70} height={14} />
                <Skeleton width={90} height={14} />
              </div>
              <Skeleton height={28} borderRadius={4} />
              <div className="mt-1">
                <Skeleton width={100} height={10} />
              </div>
            </div>
          ))}
        </SkeletonRegion>
      ) : sportData.length === 0 ? (
        <div className="text-center text-muted-text py-6">
          <small>No sports configured</small>
        </div>
      ) : (
        <>
          {sportData.map((sport) => (
            <SportProgressRow key={sport.sport} sport={sport} yearContext={yearContext} />
          ))}

          {/* The legend names the track's marks, so it goes with the tracks. */}
          {sportData.some((sport) => sport.hasGoal) && (
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
}

function SportProgressRow({ sport, yearContext }: SportProgressRowProps) {
  if (!sport.hasGoal) {
    return <NoGoalRow sport={sport} year={yearContext.year} />;
  }

  const { label: status, delta } = getStatusForDashboard(
    sport.currentValue,
    sport.targetGoal,
    yearContext
  );

  // Natural phrasing: "43.3 mi ahead" / "On track" / "10.8 mi behind"
  let statusDisplay: ReactNode = status ?? <MissingValue />;
  if (delta !== null && status !== "On Track") {
    const formatted = formatMetricDisplayValue(Math.abs(delta), sport.metricType, sport.metricUnit);
    const direction = delta >= 0 ? "ahead" : "behind";
    statusDisplay = `${formatted} ${direction}`;
  }

  const current = formatMetricDisplayValue(sport.currentValue, sport.metricType, sport.metricUnit);
  const target = formatMetricDisplayValue(sport.targetGoal, sport.metricType, sport.metricUnit);

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
        marker={yearContext.shouldShowPacing ? getYearElapsedShare(yearContext) : undefined}
        color={sport.color}
        label={`${sport.displayName} goal progress`}
      />
      <span className="text-xs text-muted-text">
        {current} / {target}
      </span>
    </div>
  );
}

/**
 * A sport the athlete hasn't set a goal for: this year's total, and where goals are set.
 * The sport's page shows suggested goals until one is saved.
 */
function NoGoalRow({ sport, year }: { sport: SportGoalData; year: number }) {
  const params = { sport: sport.sport, year: String(year) };
  return (
    <div className="flex flex-col gap-1 mb-4">
      <div className="flex justify-between items-baseline gap-3">
        <Link to="/$sport/$year" params={params} className="text-sm text-body-text">
          {sport.displayName}
        </Link>
        <span className="text-(length:--status-size) tracking-(--status-tracking) [text-transform:var(--status-case)] text-subtle-text">
          No goal
        </span>
      </div>
      <span className="text-xs text-muted-text">
        {formatMetricDisplayValue(sport.currentValue, sport.metricType, sport.metricUnit)}
        {" · "}
        {/* Named for its sport, since every row without a goal has one of these. */}
        <Link to="/$sport/$year" params={params} aria-label={`Set a goal for ${sport.displayName}`}>
          Set a goal
        </Link>
      </span>
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
  /**
   * Null with nothing logged before any of the year has elapsed, when there's no pace to
   * judge yet. Not on the year's first day: that day counts as elapsed, so nothing logged by
   * then is behind.
   */
  label: string | null;
  /** Delta between current value and prorated goal (positive = ahead, negative = behind). null when no delta applies. */
  delta: number | null;
}

export function getStatusForDashboard(
  currentValue: number,
  targetGoal: number,
  yearContext: Pick<YearContext, "year" | "daysElapsed" | "isPastYear">
): DashboardStatus {
  const progress = targetGoal > 0 ? (currentValue / targetGoal) * 100 : 0;

  if (yearContext.isPastYear) {
    return { label: progress >= 100 ? "Achieved" : "Not Met", delta: null };
  }

  if (progress >= 100) return { label: "Achieved", delta: null };

  // Calculate pace ratio: actual vs expected at this point
  const proratedGoal = targetGoal * getYearElapsedShare(yearContext);
  if (proratedGoal === 0) return { label: currentValue > 0 ? "Ahead" : null, delta: null };
  const paceRatio = currentValue / proratedGoal;
  const delta = currentValue - proratedGoal;

  if (paceRatio >= PACE_THRESHOLDS.AHEAD) return { label: "Ahead", delta };
  if (paceRatio >= PACE_THRESHOLDS.ON_TRACK) return { label: "On Track", delta };
  if (paceRatio >= PACE_THRESHOLDS.SLIGHTLY_BEHIND) return { label: "Slightly Behind", delta };
  return { label: "Behind", delta };
}
