import { useState, useEffect, useMemo } from "react";
import { useActivities } from "../../hooks/useActivities";
import { useAuth } from "../../hooks/useAuth";
import NeonSpinner from "../NeonSpinner";
import type { TimeRange } from "../../utils/dataNormalization";

import { getTimeRangeCutoff as getCutoff } from "../../utils/chartUtils";
import { toLocalDateString as toLocal } from "../../utils/dateUtils";

function getDateRangeFromTimeRange(timeRange: TimeRange): { from: string; to: string } {
  const now = new Date();
  const to = toLocal(now);
  const cutoff = getCutoff(now, timeRange);
  const from = toLocal(cutoff);
  return { from, to };
}

/**
 * Format distance in miles.
 */
function formatDistance(meters: number): string {
  if (!meters) return "";
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
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

export default function RecentActivitiesList({ timeRange, pageSize }: RecentActivitiesListProps) {
  const { user } = useAuth();
  const [page, setPage] = useState(0);

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
  const startIdx = page * pageSize;
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

  if (!user) {
    return (
      <div
        className="d-flex align-items-center justify-content-center h-100 text-muted"
        style={{ fontSize: "0.8rem" }}
      >
        Sign in to see activities
      </div>
    );
  }

  if (isLoading && activities.length === 0) {
    return (
      <div className="d-flex align-items-center justify-content-center h-100">
        <NeonSpinner size="sm" />
      </div>
    );
  }

  if (error) {
    return (
      <div
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
        className="d-flex align-items-center justify-content-center h-100 text-muted"
        style={{ fontSize: "0.8rem" }}
      >
        No activities in this time range
      </div>
    );
  }

  const showPagination = totalPages > 1 || hasMore;

  return (
    <div className="d-flex h-100">
      {/* Activities table */}
      <table
        className="table table-sm table-borderless table-dark-transparent mb-0 flex-grow-1"
        style={{ fontSize: "0.8rem", lineHeight: 1.2 }}
      >
        <tbody>
          {visibleActivities.map((activity) => (
            <tr key={activity.id}>
              <td
                className="text-start ps-0 pe-2 py-1"
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 140,
                }}
              >
                <a
                  href={`https://www.strava.com/activities/${activity.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-decoration-none"
                >
                  {activity.name}
                </a>
              </td>
              <td className="text-muted text-end px-1 py-1" style={{ whiteSpace: "nowrap" }}>
                {formatDistance(activity.distanceMeters)}
              </td>
              <td className="text-muted text-end px-1 py-1" style={{ whiteSpace: "nowrap" }}>
                {formatDuration(activity.movingTimeSeconds)}
              </td>
              <td className="text-muted text-end ps-1 pe-0 py-1" style={{ whiteSpace: "nowrap" }}>
                {formatActivityDate(activity.startDateLocal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination controls - always reserve space for stable layout */}
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
