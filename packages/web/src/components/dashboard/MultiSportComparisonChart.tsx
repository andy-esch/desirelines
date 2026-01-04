import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis } from "recharts";
import { useMultiSportData, type Sport } from "../../hooks/useMultiSportData";
import { useActivities } from "../../hooks/useActivities";
import { useAuth } from "../../hooks/useAuth";
import type { TimeRange } from "../../utils/dataNormalization";
import TimeRangeSelector from "./TimeRangeSelector";
import type { MetricsEntry } from "../../api/activities";
import NeonSpinner from "../NeonSpinner";

// Sport colors - NEON theme (CMY)
const SPORT_COLORS: Record<Sport, string> = {
  cycling: "rgb(0, 255, 255)", // Cyan
  running: "rgb(255, 0, 255)", // Magenta
  yoga: "rgb(0, 255, 128)", // Green-Cyan
};

const SPORT_LABELS: Record<Sport, string> = {
  cycling: "Cycling",
  running: "Running",
  yoga: "Yoga",
};

interface MultiSportComparisonChartProps {
  className?: string;
}

/**
 * Get the primary metric value for a sport.
 */
function getMetricValue(entry: MetricsEntry, sport: Sport): number {
  if (sport === "yoga") {
    return entry.time ?? 0;
  }
  return entry.distance ?? 0;
}

/**
 * Convert cumulative data to daily values (deltas).
 */
function toDailyValues(data: MetricsEntry[], sport: Sport): { date: string; value: number }[] {
  if (data.length === 0) return [];

  const result: { date: string; value: number }[] = [];
  let prevValue = 0;

  for (const entry of data) {
    const currentValue = getMetricValue(entry, sport);
    const dailyValue = Math.max(0, currentValue - prevValue);
    result.push({ date: entry.date, value: dailyValue });
    prevValue = currentValue;
  }

  return result;
}

/**
 * Parse a YYYY-MM-DD string as a local date (not UTC).
 * new Date("2026-01-01") creates UTC midnight, which can be Dec 31 in local time.
 * This function creates a date at local midnight instead.
 */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Filter daily values by time range.
 */
function filterDailyByTimeRange(
  data: { date: string; value: number }[],
  timeRange: TimeRange
): { date: string; value: number }[] {
  if (data.length === 0) return [];

  const now = new Date();
  const cutoff = getTimeRangeCutoff(now, timeRange);

  return data.filter((entry) => {
    const entryDate = parseLocalDate(entry.date);
    return entryDate >= cutoff && entryDate <= now;
  });
}

/**
 * Get the cutoff date for a time range.
 */
function getTimeRangeCutoff(now: Date, timeRange: TimeRange): Date {
  const cutoff = new Date(now);

  switch (timeRange) {
    case "2weeks":
      cutoff.setDate(now.getDate() - 14);
      break;
    case "4weeks":
      cutoff.setDate(now.getDate() - 28);
      break;
    case "2months":
      cutoff.setMonth(now.getMonth() - 2);
      break;
    case "6months":
      cutoff.setMonth(now.getMonth() - 6);
      break;
    case "ytd":
      cutoff.setMonth(0);
      cutoff.setDate(1);
      cutoff.setHours(0, 0, 0, 0);
      break;
  }

  return cutoff;
}

/**
 * Normalize daily values to 0-1 scale.
 */
function normalizeToRange(
  data: { date: string; value: number }[]
): { date: string; value: number }[] {
  if (data.length === 0) return [];

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  // If no range, return flat line at 0.5
  if (range === 0) {
    return data.map((d) => ({ date: d.date, value: 0.5 }));
  }

  return data.map((d) => ({
    date: d.date,
    value: (d.value - min) / range,
  }));
}

// Darker text colors for readability on light backgrounds
const SPORT_TEXT_COLORS: Record<Sport, string> = {
  cycling: "rgb(0, 160, 160)", // Darker cyan
  running: "rgb(180, 0, 180)", // Darker magenta
  yoga: "rgb(0, 160, 80)", // Darker green
};

/**
 * Format date for x-axis tick (e.g., "Dec 15").
 * Uses parseLocalDate to avoid UTC conversion issues.
 */
function formatAxisDate(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Individual sparkline row component.
 */
function SparklineRow({
  sport,
  data,
  color,
  showXAxis = false,
}: {
  sport: Sport;
  data: { date: string; value: number }[];
  color: string;
  showXAxis?: boolean;
}) {
  const hasData = data.length > 0;
  const textColor = SPORT_TEXT_COLORS[sport];
  const currentYear = new Date().getFullYear();

  // Height is taller when showing x-axis (need room for axis labels)
  const chartHeight = showXAxis ? 60 : 36;

  return (
    <div className={`d-flex gap-2 ${showXAxis ? "align-items-start" : "align-items-center"}`}>
      {/* Label - links to sport page */}
      <Link
        to={`/${sport}/${currentYear}`}
        className="text-end small text-decoration-none"
        style={{
          width: 55,
          color: textColor,
          fontWeight: 600,
          fontSize: "0.75rem",
          paddingTop: showXAxis ? 12 : 0,
        }}
      >
        {SPORT_LABELS[sport]}
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

const PAGE_SIZE = 4;

/**
 * Format a date as YYYY-MM-DD in local timezone.
 * Avoids toISOString() which converts to UTC and can shift the date.
 */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
function RecentActivitiesList({ timeRange }: { timeRange: TimeRange }) {
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

  const totalPages = Math.ceil(activities.length / PAGE_SIZE);
  const startIdx = page * PAGE_SIZE;
  const visibleActivities = activities.slice(startIdx, startIdx + PAGE_SIZE);

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
        className="table table-sm table-borderless mb-0 flex-grow-1"
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
                {formatDistance(activity.distance_meters)}
              </td>
              <td className="text-muted text-end px-1 py-1" style={{ whiteSpace: "nowrap" }}>
                {formatDuration(activity.moving_time_seconds)}
              </td>
              <td className="text-muted text-end ps-1 pe-0 py-1" style={{ whiteSpace: "nowrap" }}>
                {formatActivityDate(activity.start_date_local)}
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

  // Calculate date range for API query
  const { from, to } = useMemo(() => getDateRangeFromTimeRange(timeRange), [timeRange]);

  // Fetch data using date-range query (can span years seamlessly)
  const { data, isLoading, error } = useMultiSportData({ year: currentYear, from, to });

  // Process data for each sport's sparkline
  // Order: cumulative -> daily deltas -> filter by range -> normalize 0-1
  const sparklineData = useMemo(() => {
    const sports: Sport[] = ["cycling", "running", "yoga"];

    return sports.map((sport) => {
      const sportData = data[sport] || [];
      // 1. Convert cumulative to daily values (needs full dataset)
      const dailyValues = toDailyValues(sportData, sport);
      // 2. Filter to time range
      const filtered = filterDailyByTimeRange(dailyValues, timeRange);
      // 3. Normalize to 0-1 for sparkline display
      const normalized = normalizeToRange(filtered);
      return { sport, data: normalized };
    });
  }, [data, timeRange]);

  if (isLoading) {
    return (
      <div className={className}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h5 mb-0">Recent Activity</h2>
        </div>
        <div
          className="bg-light rounded d-flex align-items-center justify-content-center"
          style={{ height: 140 }}
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
          className="bg-light rounded d-flex align-items-center justify-content-center"
          style={{ height: 140 }}
        >
          <p className="text-muted mb-0">No activity data for selected time range</p>
        </div>
      ) : (
        <div className="row g-3 justify-content-center">
          {/* Left: Sparklines */}
          <div className="col-md-6" style={{ minWidth: 0 }}>
            <div
              className="border rounded p-2 h-100 d-flex flex-column justify-content-center gap-2"
              style={{ minHeight: 185, minWidth: 0 }}
            >
              {sparklineData.map(({ sport, data: sData }, index) => (
                <SparklineRow
                  key={sport}
                  sport={sport}
                  data={sData}
                  color={SPORT_COLORS[sport]}
                  showXAxis={index === sparklineData.length - 1}
                />
              ))}
            </div>
          </div>

          {/* Right: Recent Activities */}
          <div className="col-md-6">
            <div className="border rounded p-2 h-100 overflow-hidden" style={{ minHeight: 185 }}>
              <RecentActivitiesList timeRange={timeRange} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
