import React from "react";
import type { ActivitySummary } from "../api/activities";
import {
  formatDistance,
  formatElevation,
  type DistanceUnit,
  type ElevationUnit,
} from "../utils/units";
import NeonSpinner from "./NeonSpinner";

interface ActivityTableProps {
  activities: ActivitySummary[];
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  distanceUnit?: DistanceUnit;
  elevationUnit?: ElevationUnit;
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

/** Get sport badge color */
function getSportBadgeClass(sport: string): string {
  switch (sport) {
    case "cycling":
      return "bg-primary";
    case "running":
      return "bg-success";
    case "yoga":
      return "bg-info";
    default:
      return "bg-secondary";
  }
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

  if (sport === "running") {
    // Pace: min/mi or min/km
    const distanceUnits =
      distanceUnit === "miles" ? distanceMeters * 0.000621371 : distanceMeters * 0.001;
    const paceMinutes = timeSeconds / 60 / distanceUnits;
    const paceMin = Math.floor(paceMinutes);
    const paceSec = Math.round((paceMinutes - paceMin) * 60);
    const unitLabel = distanceUnit === "miles" ? "mi" : "km";
    return `${paceMin}:${paceSec.toString().padStart(2, "0")}/${unitLabel}`;
  } else if (sport === "cycling") {
    // Speed: mph or km/h
    const hours = timeSeconds / 3600;
    const distanceUnits =
      distanceUnit === "miles" ? distanceMeters * 0.000621371 : distanceMeters * 0.001;
    const speed = distanceUnits / hours;
    const unitLabel = distanceUnit === "miles" ? "mph" : "km/h";
    return `${speed.toFixed(1)} ${unitLabel}`;
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
}) => {
  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        <strong>Error loading activities:</strong> {error.message}
        <button className="btn btn-outline-danger btn-sm ms-3" onClick={onRetry}>
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
    <div className="card">
      <div className="card-body p-0">
        <div className="table-responsive">
          <table className="table table-hover table-sm mb-0">
            <thead className="table-light">
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Sport</th>
                <th className="text-end">Distance</th>
                <th className="text-end">Time</th>
                <th className="text-end">Elevation</th>
                <th className="text-end">Pace/Speed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => (
                <tr key={activity.id}>
                  <td className="text-nowrap">{formatDate(activity.start_date_local)}</td>
                  <td>
                    <span className="text-truncate d-inline-block" style={{ maxWidth: "200px" }}>
                      {activity.name}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${getSportBadgeClass(activity.sport)}`}>
                      {activity.sport}
                    </span>
                  </td>
                  <td className="text-end text-nowrap">
                    {activity.distance_meters > 0
                      ? formatDistance(activity.distance_meters, distanceUnit)
                      : "-"}
                  </td>
                  <td className="text-end text-nowrap">
                    {formatDuration(activity.moving_time_seconds)}
                  </td>
                  <td className="text-end text-nowrap">
                    {activity.elevation_meters
                      ? formatElevation(activity.elevation_meters, elevationUnit)
                      : "-"}
                  </td>
                  <td className="text-end text-nowrap">
                    {formatPaceOrSpeed(
                      activity.distance_meters,
                      activity.moving_time_seconds,
                      activity.sport,
                      distanceUnit
                    )}
                  </td>
                  <td className="text-end pe-3">
                    <a
                      href={`https://www.strava.com/activities/${activity.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted"
                      title="View on Strava"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        fill="currentColor"
                        viewBox="0 0 16 16"
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
          <div className="text-center py-4">
            <NeonSpinner />
          </div>
        )}

        {/* Load more button */}
        {!isLoading && hasMore && (
          <div className="text-center py-3 border-top">
            <button className="btn btn-ghost-slate" onClick={onLoadMore}>
              Load More
            </button>
          </div>
        )}

        {/* End of results indicator */}
        {!isLoading && !hasMore && activities.length > 0 && (
          <div className="text-center text-muted py-3 border-top">
            <small>Showing all {activities.length} activities</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivityTable;
