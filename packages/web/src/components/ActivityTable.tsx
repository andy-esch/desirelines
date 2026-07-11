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
import { formatDisplayDate } from "../utils/dateUtils";
import NeonSpinner from "./NeonSpinner";
import { ExternalLinkIcon } from "./ui/ExternalLinkIcon";
import { MapPinIcon } from "./ui/MapPinIcon";

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
  /** Navigate to the routes map focused on this activity (the "View on map" link).
   *  A handler (not a route inside the table) keeps the table router-context-free;
   *  the page wires it to client-side navigation. Omit to hide the affordance for
   *  the whole table; per row, the pin also only shows when `activity.hasRoute`
   *  (the routes map can't display a routeless/indoor activity). */
  onViewOnMap?: (activityId: string) => void;
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
  onViewOnMap,
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
                  <td className="whitespace-nowrap">
                    {formatDisplayDate(new Date(activity.startDateLocal), {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
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
                    <div className="inline-flex items-center gap-3">
                      {onViewOnMap && activity.hasRoute && (
                        <button
                          type="button"
                          onClick={() => onViewOnMap(activity.id)}
                          className="text-slate-light hover:text-accent-cyan motion-safe:transition-colors"
                          title="View on map"
                          aria-label="View this activity on the map"
                        >
                          <MapPinIcon size={14} />
                        </button>
                      )}
                      <a
                        href={`https://www.strava.com/activities/${activity.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-light"
                        title="View on Strava"
                      >
                        <ExternalLinkIcon size={14} />
                      </a>
                    </div>
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
