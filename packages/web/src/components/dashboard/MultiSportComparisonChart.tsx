import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useMultiSportData, type Sport } from "../../hooks/useMultiSportData";
import { useActivities } from "../../hooks/useActivities";
import { useAuth } from "../../hooks/useAuth";
import type { TimeRange } from "../../utils/dataNormalization";
import TimeRangeSelector from "./TimeRangeSelector";
import type { MetricsEntry } from "../../api/activities";

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
    const entryDate = new Date(entry.date);
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
 * Individual sparkline row component.
 */
function SparklineRow({
  sport,
  data,
  color,
}: {
  sport: Sport;
  data: { date: string; value: number }[];
  color: string;
}) {
  const hasData = data.length > 0;
  const textColor = SPORT_TEXT_COLORS[sport];
  const currentYear = new Date().getFullYear();

  return (
    <div className="d-flex align-items-center gap-2">
      {/* Label - links to sport page */}
      <Link
        to={`/${sport}/${currentYear}`}
        className="text-end small text-decoration-none"
        style={{ width: 55, color: textColor, fontWeight: 600, fontSize: "0.75rem" }}
      >
        {SPORT_LABELS[sport]}
      </Link>

      {/* Sparkline */}
      <div style={{ flex: 1, height: 36 }}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
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
 * Convert TimeRange to from/to date strings for API.
 */
function getDateRangeFromTimeRange(timeRange: TimeRange): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  const cutoff = getTimeRangeCutoff(now, timeRange);
  const from = cutoff.toISOString().split("T")[0];
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

  // Reset page when activities change (time range changed)
  useMemo(() => {
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
        <div className="spinner-border spinner-border-sm text-secondary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
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
                className="ps-0 pe-2 py-1"
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

  const { data, isLoading, error } = useMultiSportData(currentYear);

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
          <div className="spinner-border spinner-border-sm text-secondary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
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
          <div className="col-md-6">
            <div className="border rounded p-2 h-100 d-flex flex-column justify-content-center gap-2">
              {sparklineData.map(({ sport, data: sData }) => (
                <SparklineRow key={sport} sport={sport} data={sData} color={SPORT_COLORS[sport]} />
              ))}
            </div>
          </div>

          {/* Right: Recent Activities */}
          <div className="col-md-6">
            <div className="border rounded p-2 h-100 overflow-hidden">
              <RecentActivitiesList timeRange={timeRange} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
