import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useActivities } from "../../hooks/useActivities";
import { useAuth } from "../../hooks/useAuth";
import { useDashboardGoalData } from "../../hooks/useDashboardGoalData";
import type { SportGoalData } from "../../hooks/useDashboardGoalData";
import { useUserConfig } from "../../hooks/useUserConfig";
import NeonSpinner from "../NeonSpinner";
import type { TimeRange } from "../../utils/dataNormalization";
import {
  convertDistance,
  formatDistance,
  formatImpactPct,
  getUserSettings,
} from "../../utils/units";

import { getTimeRangeCutoff as getCutoff } from "../../utils/chartUtils";
import { toLocalDateString as toLocal } from "../../utils/dateUtils";

/** Height of the thead row in px */
const HEADER_HEIGHT = 22;
/** Height of each data row in px */
const ROW_HEIGHT = 28;
/** Minimum rows to show */
const MIN_ROWS = 3;

function getDateRangeFromTimeRange(timeRange: TimeRange): { from: string; to: string } {
  const now = new Date();
  const to = toLocal(now);
  const cutoff = getCutoff(now, timeRange);
  const from = toLocal(cutoff);
  return { from, to };
}

/**
 * Format duration.
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/**
 * Format activity date as "Mon DD".
 */
function formatActivityDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface RecentActivitiesListProps {
  timeRange: TimeRange;
  pageSize: number;
}

export default function RecentActivitiesList({
  timeRange,
  pageSize: fallbackPageSize,
}: RecentActivitiesListProps) {
  const { user } = useAuth();
  const [page, setPage] = useState(0);

  // Dynamically measure container height to compute page size
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  const handleResize = useCallback(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight);
    }
  }, []);

  useEffect(() => {
    handleResize();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleResize]);

  const pageSize =
    containerHeight > 0
      ? Math.max(MIN_ROWS, Math.floor((containerHeight - HEADER_HEIGHT) / ROW_HEIGHT))
      : fallbackPageSize;

  // User preferences for distance unit
  const { data: prefs } = useUserConfig("preferences");
  const distanceUnit = useMemo(() => getUserSettings(prefs).distanceUnit, [prefs]);

  // Goal data for impact % column
  const { sportData } = useDashboardGoalData();
  const goalLookup = useMemo(() => {
    const lookup: Record<string, SportGoalData> = {};
    for (const g of sportData) {
      lookup[g.sport] = g;
    }
    return lookup;
  }, [sportData]);

  // Reset page when time range changes
  const { from, to } = useMemo(() => getDateRangeFromTimeRange(timeRange), [timeRange]);

  const { activities, isLoading, error, hasMore, loadMore } = useActivities({
    from,
    to,
    limit: 20,
  });

  // Reset page when time range changes
  useEffect(() => {
    setPage(0);
  }, [from, to]);

  const totalPages = Math.ceil(activities.length / pageSize);
  // Clamp page if pageSize changed (e.g. container resized) and current page is now out of range
  const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
  if (clampedPage !== page) setPage(clampedPage);
  const startIdx = clampedPage * pageSize;
  const visibleActivities = activities.slice(startIdx, startIdx + pageSize);

  const canGoUp = page > 0;
  const canGoDown = page < totalPages - 1 || hasMore;

  const handleNextPage = () => {
    if (page < totalPages - 1) {
      setPage((p) => p + 1);
    } else if (hasMore) {
      loadMore();
      setPage((p) => p + 1);
    }
  };

  if (isLoading && activities.length === 0) {
    return (
      <div ref={containerRef} className="d-flex align-items-center justify-content-center h-100">
        <NeonSpinner size="sm" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        ref={containerRef}
        className="d-flex align-items-center justify-content-center h-100 text-danger"
        style={{ fontSize: "0.8rem" }}
      >
        Failed to load activities
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div
        ref={containerRef}
        className="d-flex align-items-center justify-content-center h-100 text-muted"
        style={{ fontSize: "0.8rem" }}
      >
        No activities in this time range
      </div>
    );
  }

  const showPagination = totalPages > 1 || hasMore;

  return (
    <div ref={containerRef} className="d-flex h-100">
      {/* Activities table */}
      <table
        className="table table-sm table-borderless table-dark-transparent mb-0 flex-grow-1"
        style={{ fontSize: "0.8rem", lineHeight: 1.2, tableLayout: "fixed" }}
      >
        <colgroup>
          <col />
          <col style={{ width: 70 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 55 }} />
          <col style={{ width: 58 }} />
        </colgroup>
        <thead>
          <tr style={{ height: HEADER_HEIGHT }}>
            <th
              className="text-start ps-0 pe-2 py-0 text-muted fw-normal align-middle"
              style={{ fontSize: "0.7rem" }}
            >
              Name
            </th>
            <th
              className="text-start px-1 py-0 text-muted fw-normal align-middle"
              style={{ fontSize: "0.7rem" }}
            >
              Sport
            </th>
            <th
              className="text-end px-1 py-0 text-muted fw-normal align-middle"
              style={{ fontSize: "0.7rem" }}
            >
              Goal Impact
            </th>
            <th
              className="text-end px-1 py-0 text-muted fw-normal align-middle"
              style={{ fontSize: "0.7rem" }}
            >
              Distance
            </th>
            <th
              className="text-end px-1 py-0 text-muted fw-normal align-middle"
              style={{ fontSize: "0.7rem" }}
            >
              Time
            </th>
            <th
              className="text-end ps-1 pe-0 py-0 text-muted fw-normal align-middle"
              style={{ fontSize: "0.7rem" }}
            >
              Date
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleActivities.map((activity) => {
            const goal = goalLookup[activity.sport];
            let impactPct: number | null = null;
            let impactTooltip = "";
            if (goal?.impactGoal) {
              if (goal.isDistanceSport) {
                const displayDist = convertDistance(activity.distanceMeters, distanceUnit);
                impactPct = (displayDist / goal.impactGoal) * 100;
              } else {
                impactPct = (1 / goal.impactGoal) * 100;
              }
              const goalLabel = goal.impactGoalLabel ? `${goal.impactGoalLabel} goal` : "goal";
              impactTooltip = `vs. ${Math.round(goal.impactGoal).toLocaleString()} ${goal.metricUnit} ${goalLabel}`;
            }
            return (
              <tr key={activity.id} style={{ height: ROW_HEIGHT }}>
                <td
                  className="text-start ps-0 pe-2 py-0 align-middle"
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 140,
                  }}
                >
                  {user ? (
                    <a
                      href={`https://www.strava.com/activities/${activity.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-decoration-none"
                    >
                      {activity.name}
                    </a>
                  ) : (
                    <span title="Links disabled in demo mode">{activity.name}</span>
                  )}
                </td>
                <td
                  className="text-muted text-start px-1 py-0 align-middle"
                  style={{ whiteSpace: "nowrap", textTransform: "capitalize" }}
                >
                  {activity.sport}
                </td>
                <td
                  className="text-muted text-end px-1 py-0 align-middle"
                  style={{ whiteSpace: "nowrap", fontSize: "0.75rem" }}
                  title={impactTooltip}
                >
                  {formatImpactPct(impactPct)}
                </td>
                <td
                  className="text-muted text-end px-1 py-0 align-middle"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {activity.distanceMeters
                    ? formatDistance(activity.distanceMeters, distanceUnit)
                    : ""}
                </td>
                <td
                  className="text-muted text-end px-1 py-0 align-middle"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {formatDuration(activity.movingTimeSeconds)}
                </td>
                <td
                  className="text-muted text-end ps-1 pe-0 py-0 align-middle"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {formatActivityDate(activity.startDateLocal)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Pagination controls - vertically centered */}
      <div
        className="d-flex flex-column justify-content-center ms-2"
        style={{ minWidth: 32, visibility: showPagination ? "visible" : "hidden" }}
      >
        <button
          className="btn btn-sm btn-link p-0 text-muted"
          onClick={() => setPage((p) => p - 1)}
          disabled={!canGoUp}
          style={{ opacity: canGoUp ? 1 : 0.3 }}
          aria-label="Newer activities"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4l5 6H3l5-6z" />
          </svg>
        </button>
        <span className="text-muted text-center" style={{ fontSize: "0.7rem", lineHeight: 1.3 }}>
          {page + 1}/{hasMore ? "+" : totalPages}
        </span>
        <button
          className="btn btn-sm btn-link p-0 text-muted"
          onClick={handleNextPage}
          disabled={!canGoDown}
          style={{ opacity: canGoDown ? 1 : 0.3 }}
          aria-label="Older activities"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 12l5-6H3l5 6z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
