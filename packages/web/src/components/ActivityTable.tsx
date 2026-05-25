import React from "react";
import type { ActivitySummary } from "../api/activities";
import {
  convertDistance,
  formatDistance,
  formatElevation,
  formatImpactPct,
  getDistanceLabel,
  type DistanceUnit,
  type ElevationUnit,
} from "../utils/units";
import { SPORT_COLORS } from "../utils/sportConfig";
import NeonSpinner from "./NeonSpinner";

/** Speed unit label for each supported distance unit (cycling display). */
const SPEED_LABEL: Record<DistanceUnit, string> = {
  miles: "mph",
  kilometers: "km/h",
  meters: "m/h",
};

interface ActivityTableProps {
  activities: ActivitySummary[];
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  distanceUnit?: DistanceUnit;
  elevationUnit?: ElevationUnit;
  /** Annual goal target in display units. When set, shows "Impact" column. */
  goalTarget?: number;
  /** Whether this is a session-based sport (no distance). */
  isSessionSport?: boolean;
}

/** Format seconds to MM:SS or H:MM:SS */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/** Format date to readable format */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Calculate and format pace (running) or speed (cycling) */
function formatPaceOrSpeed(
  distanceMeters: number,
  timeSeconds: number,
  sport: string,
  distanceUnit: DistanceUnit
): string {
  if (distanceMeters <= 0 || timeSeconds <= 0) {
    return "-";
  }

  const distanceInUnits = convertDistance(distanceMeters, distanceUnit);

  if (sport === "running") {
    // Pace: min/<unit>
    const paceMinutes = timeSeconds / 60 / distanceInUnits;
    const paceMin = Math.floor(paceMinutes);
    const paceSec = Math.round((paceMinutes - paceMin) * 60);
    return `${paceMin}:${paceSec.toString().padStart(2, "0")}/${getDistanceLabel(distanceUnit)}`;
  } else if (sport === "cycling") {
    // Speed in <unit>/hour
    const hours = timeSeconds / 3600;
    const speed = distanceInUnits / hours;
    return `${speed.toFixed(1)} ${SPEED_LABEL[distanceUnit]}`;
  }

  // Other sports (yoga, etc.) - no pace/speed
  return "-";
}

const ActivityTable: React.FC<ActivityTableProps> = ({
  activities,
  isLoading,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  distanceUnit = "miles",
  elevationUnit = "feet",
  goalTarget,
  isSessionSport = false,
}) => {
  const showImpact = goalTarget != null && goalTarget > 0;
  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        <strong>Error loading activities:</strong> {error.message}
        <button className="btn btn-outline-danger btn-sm ms-6" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (!isLoading && activities.length === 0) {
    return (
      <div className="alert alert-info" role="alert">
        No activities found for the selected filters.
      </div>
    );
  }

  return (
    <div className="card glass-panel">
      <div className="card-body p-0">
        <div className="overflow-x-auto">
          <table className="table table-hover table-sm table-dark-transparent mb-0">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Sport</th>
                <th className="text-right">Distance</th>
                <th className="text-right">Time</th>
                <th className="text-right">Elevation</th>
                <th className="text-right">Pace/Speed</th>
                {showImpact && <th className="text-right">Impact</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => (
                <tr key={activity.id}>
                  <td className="whitespace-nowrap">{formatDate(activity.startDateLocal)}</td>
                  <td>
                    <a
                      href={`https://www.strava.com/activities/${activity.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-truncate inline-block"
                      style={{ maxWidth: "200px" }}
                    >
                      {activity.name}
                    </a>
                  </td>
                  <td>
                    <span
                      className="badge badge-sport"
                      style={
                        {
                          "--sport-color": SPORT_COLORS[activity.sport] || "rgb(160, 174, 192)",
                        } as React.CSSProperties
                      }
                    >
                      {activity.sport}
                    </span>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {activity.distanceMeters > 0
                      ? formatDistance(activity.distanceMeters, distanceUnit)
                      : "-"}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {formatDuration(activity.movingTimeSeconds)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {activity.elevationMeters
                      ? formatElevation(activity.elevationMeters, elevationUnit)
                      : "-"}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {formatPaceOrSpeed(
                      activity.distanceMeters,
                      activity.movingTimeSeconds,
                      activity.sport,
                      distanceUnit
                    )}
                  </td>
                  {showImpact && goalTarget > 0 && (
                    <td className="text-right whitespace-nowrap text-slate-light">
                      {formatImpactPct(
                        isSessionSport
                          ? (1 / goalTarget) * 100
                          : activity.distanceMeters > 0
                            ? (convertDistance(activity.distanceMeters, distanceUnit) /
                                goalTarget) *
                              100
                            : null
                      )}
                    </td>
                  )}
                  <td className="text-right pe-6">
                    <a
                      href={`https://www.strava.com/activities/${activity.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-light"
                      title="View on Strava"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"
                        />
                        <path
                          fillRule="evenodd"
                          d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"
                        />
                      </svg>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Loading indicator */}
        {isLoading && (
          <div className="text-center py-6">
            <NeonSpinner />
          </div>
        )}

        {/* Load more button */}
        {!isLoading && hasMore && (
          <div className="text-center py-6 border-t">
            <button className="btn btn-ghost-slate" onClick={onLoadMore}>
              Load More
            </button>
          </div>
        )}

        {/* End of results indicator */}
        {!isLoading && !hasMore && activities.length > 0 && (
          <div className="text-center text-slate-light py-6 border-t">
            <small>Showing all {activities.length} activities</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivityTable;
