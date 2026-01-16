import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis } from "recharts";
import { useDailySportData } from "../../hooks/useDailySportData";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { useSportConfig } from "../../hooks/useSportConfig";
import { useActivities } from "../../hooks/useActivities";
import { useAuth } from "../../hooks/useAuth";
import type { TimeRange } from "../../utils/dataNormalization";
import {
  getSportColor,
  getSportTextColor,
  getSportDisplayName,
  filterValidSports,
} from "../../utils/sportConfig";
import { toLocalDateString, parseLocalDateStrict, formatDisplayDate } from "../../utils/dateUtils";
import { toDailyArray, getTimeRangeCutoff, normalizeToRange } from "../../utils/chartUtils";
import TimeRangeSelector from "./TimeRangeSelector";
import NeonSpinner from "../NeonSpinner";

interface MultiSportComparisonChartProps {
  className?: string;
}

/**
 * Format date for x-axis tick (e.g., "Dec 15").
 * Uses parseLocalDateStrict to avoid UTC conversion issues.
 */
function formatAxisDate(dateStr: string): string {
  const date = parseLocalDateStrict(dateStr);
  return formatDisplayDate(date);
}

/** Sparkline row height in pixels */
const SPARKLINE_ROW_HEIGHT = 36;
/** Extra height when showing x-axis */
const SPARKLINE_XAXIS_HEIGHT = 24;
/** Minimum number of sports for layout stability */
const MIN_SPORTS_FOR_HEIGHT = 3;
/** Maximum sports before scrolling */
const MAX_SPORTS_DISPLAY = 8;

/**
 * Individual sparkline row component.
 */
function SparklineRow({
  sport,
  displayName,
  data,
  color,
  textColor,
  showXAxis = false,
}: {
  sport: string;
  displayName: string;
  data: { date: string; value: number }[];
  color: string;
  textColor: string;
  showXAxis?: boolean;
}) {
  const hasData = data.length > 0;
  const currentYear = new Date().getFullYear();

  // Link to the year with most recent activity (data is sorted by date)
  // Falls back to current year if no data
  const linkYear = hasData ? parseInt(data[data.length - 1].date.split("-")[0], 10) : currentYear;

  // Height is taller when showing x-axis (need room for axis labels)
  const chartHeight = showXAxis
    ? SPARKLINE_ROW_HEIGHT + SPARKLINE_XAXIS_HEIGHT
    : SPARKLINE_ROW_HEIGHT;

  return (
    <div className={`d-flex gap-2 ${showXAxis ? "align-items-start" : "align-items-center"}`}>
      {/* Label - links to sport page */}
      <Link
        to={`/${sport}/${linkYear}`}
        className="text-end small text-decoration-none"
        style={{
          width: 70,
          color: textColor,
          fontWeight: 600,
          fontSize: "0.75rem",
          paddingTop: showXAxis ? 12 : 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={displayName}
      >
        {displayName}
      </Link>

      {/* Sparkline */}
      <div style={{ flex: 1, height: chartHeight, minWidth: 0 }}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={50} minHeight={30}>
            <LineChart
              data={data}
              margin={{ top: 4, right: 4, bottom: showXAxis ? 16 : 4, left: 4 }}
            >
              {showXAxis && (
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 9, fill: "#999" }}
                  tickFormatter={formatAxisDate}
                  interval="preserveStartEnd"
                  minTickGap={50}
                />
              )}
              <Line
                type="linear"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div
            className="d-flex align-items-center justify-content-center h-100 text-muted"
            style={{ fontSize: "0.65rem" }}
          >
            No data
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Determine how many activities to show based on available height.
 *
 * RATIONALE: The activity list shares vertical space with sparklines.
 * As more sports are visible (more sparkline rows), the container grows taller,
 * so we can display more activities without the list feeling cramped.
 *
 * The page size values were chosen empirically to maintain visual balance:
 * - 3 or fewer sports: 4 activities (short list, compact layout)
 * - 4-5 sports: 5 activities (medium height)
 * - 6-7 sports: 6 activities (taller layout)
 * - 8+ sports: 7 activities (maximum before scrolling kicks in)
 */
function getActivityPageSize(sportCount: number): number {
  const effectiveCount = Math.max(sportCount, MIN_SPORTS_FOR_HEIGHT);
  if (effectiveCount <= 3) return 4;
  if (effectiveCount <= 5) return 5;
  if (effectiveCount <= 7) return 6;
  return 7;
}

/**
 * Convert TimeRange to from/to date strings for API.
 * Uses local timezone to ensure "today" matches the user's actual day.
 */
function getDateRangeFromTimeRange(timeRange: TimeRange): { from: string; to: string } {
  const now = new Date();
  const to = toLocalDateString(now);
  const cutoff = getTimeRangeCutoff(now, timeRange);
  const from = toLocalDateString(cutoff);
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
 * Activity dates from API include time component, so regular parsing is safe.
 */
function formatActivityDate(dateStr: string): string {
  // Activity dates are in RFC3339 format with time, so Date parsing is safe
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Recent activities table component with pagination.
 */
function RecentActivitiesList({ timeRange, pageSize }: { timeRange: TimeRange; pageSize: number }) {
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

export default function MultiSportComparisonChart({
  className = "",
}: MultiSportComparisonChartProps) {
  const currentYear = new Date().getFullYear();
  const [timeRange, setTimeRange] = useState<TimeRange>("2weeks");

  // Get visible sports and sport config
  const { visibleSports, isLoading: prefsLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading } = useSportConfig();

  // Filter visible sports to only those in config (handles edge case of stale prefs)
  const validSports = useMemo(
    () => filterValidSports(visibleSports, sportConfig),
    [visibleSports, sportConfig]
  );

  // Calculate date range for API query
  const { from, to } = useMemo(() => getDateRangeFromTimeRange(timeRange), [timeRange]);

  // Fetch data for visible sports only
  const {
    data,
    isLoading: dataLoading,
    error,
  } = useDailySportData({
    year: currentYear,
    from,
    to,
    sports: validSports,
  });

  // Process data for each sport's sparkline
  const sparklineData = useMemo(() => {
    return validSports.map((sport) => {
      const sportData = data[sport] ?? {};
      // 1. Convert daily data map to sorted array
      const dailyValues = toDailyArray(sportData, sport, sportConfig);
      // 2. Normalize to 0-1 for sparkline display
      const normalized = normalizeToRange(dailyValues);
      return {
        sport,
        displayName: getSportDisplayName(sport, sportConfig),
        color: getSportColor(sport),
        textColor: getSportTextColor(sport),
        data: normalized,
      };
    });
  }, [validSports, data, sportConfig]);

  // Calculate dynamic height based on number of sports
  const displayCount = Math.min(
    Math.max(validSports.length, MIN_SPORTS_FOR_HEIGHT),
    MAX_SPORTS_DISPLAY
  );
  const sparklineContainerHeight =
    displayCount * SPARKLINE_ROW_HEIGHT + SPARKLINE_XAXIS_HEIGHT + 16; // 16 for padding

  // Calculate page size for activities
  const activityPageSize = getActivityPageSize(validSports.length);

  // Combined loading state
  const isLoading = prefsLoading || configLoading || dataLoading;

  if (isLoading) {
    return (
      <div className={className}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h5 mb-0">Recent Activity</h2>
        </div>
        <div
          className="border rounded d-flex align-items-center justify-content-center"
          style={{ height: sparklineContainerHeight, background: "transparent" }}
        >
          <NeonSpinner size="sm" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${className} text-center p-4`}>
        <p className="text-danger mb-0">Failed to load activity data</p>
      </div>
    );
  }

  const hasAnyData = sparklineData.some((s) => s.data.length > 0);

  return (
    <div className={className}>
      {/* Header with time range selector */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="h5 mb-0">Recent Activity</h2>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      {!hasAnyData ? (
        <div
          className="border rounded d-flex align-items-center justify-content-center"
          style={{ height: sparklineContainerHeight, background: "transparent" }}
        >
          <p className="text-muted mb-0">No activity data for selected time range</p>
        </div>
      ) : (
        <div className="row g-3 justify-content-center">
          {/* Left: Sparklines */}
          <div className="col-md-6" style={{ minWidth: 0, overflow: "hidden" }}>
            <div
              className="border rounded p-2 h-100 d-flex flex-column justify-content-center gap-2"
              style={{
                minHeight: sparklineContainerHeight,
                maxHeight: MAX_SPORTS_DISPLAY * SPARKLINE_ROW_HEIGHT + SPARKLINE_XAXIS_HEIGHT + 32,
                overflowY: validSports.length >= MAX_SPORTS_DISPLAY ? "auto" : "visible",
                minWidth: 0,
                background: "transparent",
              }}
            >
              {sparklineData.map(({ sport, displayName, data: sData, color, textColor }, index) => (
                <SparklineRow
                  key={sport}
                  sport={sport}
                  displayName={displayName}
                  data={sData}
                  color={color}
                  textColor={textColor}
                  showXAxis={index === sparklineData.length - 1}
                />
              ))}
            </div>
          </div>

          {/* Right: Recent Activities */}
          <div className="col-md-6">
            <div
              className="border rounded p-2 h-100 overflow-hidden"
              style={{ minHeight: sparklineContainerHeight, background: "transparent" }}
            >
              <RecentActivitiesList timeRange={timeRange} pageSize={activityPageSize} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
