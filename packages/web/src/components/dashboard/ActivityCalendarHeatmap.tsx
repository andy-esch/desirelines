import { useMemo, useState } from "react";
import { useDailySportData } from "../../hooks/useDailySportData";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { useSportConfig } from "../../hooks/useSportConfig";
import { filterValidSports } from "../../utils/sportConfig";
import { toLocalDateString } from "../../utils/dateUtils";
import NeonSpinner from "../NeonSpinner";

interface ActivityCalendarHeatmapProps {
  className?: string;
}

/** Time range option for the heatmap */
type TimeRangeOption = "trailing12" | number; // "trailing12" or a specific year

/** Sport filter mode for the heatmap */
type SportFilterMode = "all" | "visible";

/** Color scale for activity intensity (NEON purple/magenta theme) */
const INTENSITY_COLORS = [
  "var(--bs-gray-200)", // 0 activities - light gray
  "rgb(180, 130, 200)", // 1 activity - soft purple
  "rgb(200, 100, 220)", // 2-3 activities - medium purple
  "rgb(220, 60, 255)", // 4-5 activities - bright purple
  "rgb(255, 0, 255)", // 6+ activities - neon magenta
];

/** Get color for activity count */
function getIntensityColor(count: number): string {
  if (count === 0) return INTENSITY_COLORS[0];
  if (count === 1) return INTENSITY_COLORS[1];
  if (count <= 3) return INTENSITY_COLORS[2];
  if (count <= 5) return INTENSITY_COLORS[3];
  return INTENSITY_COLORS[4];
}

/** Day of week labels (Sun-Sat) */
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Month labels */
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Calendar grid layout constants.
 * These values are tuned for a compact, readable GitHub-style calendar.
 */
/** Size of each day cell in pixels */
const CELL_SIZE = 11;
/** Gap between cells in pixels */
const CELL_GAP = 3;
/** Width reserved for day labels (Sun, Mon, etc.) */
const DAY_LABEL_WIDTH = 28;
/** Height reserved for month labels header */
const HEADER_HEIGHT = 14;

/**
 * Generate weeks for a date range, organized by weeks.
 * Returns array of weeks, each containing 7 days (or nulls for padding).
 */
function generateWeeksForRange(startDate: Date, endDate: Date): (Date | null)[][] {
  const weeks: (Date | null)[][] = [];

  // Find the first day of the first week
  const firstDay = startDate.getDay();

  // Add padding for days before start date
  const firstWeek: (Date | null)[] = Array(firstDay).fill(null);

  // Build weeks
  let currentWeek = firstWeek;
  const current = new Date(startDate);

  while (current <= endDate) {
    currentWeek.push(new Date(current));

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    current.setDate(current.getDate() + 1);
  }

  // Add final partial week with trailing nulls
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);
  }

  return weeks;
}

/**
 * Get month labels positioned above the calendar.
 * Returns array of { label, weekIndex, year } for months that start in that week.
 */
function getMonthLabels(
  weeks: (Date | null)[][]
): { label: string; weekIndex: number; showYear: boolean; year: number }[] {
  const labels: { label: string; weekIndex: number; showYear: boolean; year: number }[] = [];
  let lastMonthKey = "";
  let lastYear = 0;

  weeks.forEach((week, weekIndex) => {
    // Find the first non-null date in the week
    const firstDate = week.find((d) => d !== null);
    if (firstDate) {
      const month = firstDate.getMonth();
      const year = firstDate.getFullYear();
      const monthKey = `${year}-${month}`;
      if (monthKey !== lastMonthKey) {
        // Show year when it changes (January or first occurrence of a new year)
        const showYear = year !== lastYear;
        labels.push({
          label: MONTH_LABELS[month],
          weekIndex,
          showYear,
          year,
        });
        lastMonthKey = monthKey;
        lastYear = year;
      }
    }
  });

  return labels;
}

/**
 * Calculate date range for a time range option.
 * For specific years, always returns full year (Jan 1 - Dec 31) for stable layout.
 * Data beyond today will just show as 0 activities.
 */
function getDateRange(option: TimeRangeOption): {
  startDate: Date;
  endDate: Date;
  from: string;
  to: string;
} {
  const today = new Date();
  let startDate: Date;
  let endDate: Date;

  if (option === "trailing12") {
    // Trailing 12 months from today
    endDate = today;
    startDate = new Date(today);
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setDate(startDate.getDate() + 1); // Start day after same date last year
  } else {
    // Specific year - always show full year for stable layout
    const year = option;
    startDate = new Date(year, 0, 1);
    endDate = new Date(year, 11, 31);
  }

  return {
    startDate,
    endDate,
    from: toLocalDateString(startDate),
    to: toLocalDateString(endDate),
  };
}

/**
 * Get available year options for the dropdown.
 * Returns current year back to 2020 (or earlier if needed).
 */
function getYearOptions(): number[] {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let year = currentYear; year >= 2020; year--) {
    years.push(year);
  }
  return years;
}

/**
 * GitHub-style activity calendar heatmap showing activity intensity by day.
 * Defaults to trailing 12 months, with dropdown to select specific years.
 * Supports filtering by visible sports or showing all sports.
 */
export default function ActivityCalendarHeatmap({ className = "" }: ActivityCalendarHeatmapProps) {
  const [timeRange, setTimeRange] = useState<TimeRangeOption>("trailing12");
  const [sportFilter, setSportFilter] = useState<SportFilterMode>("all");
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => getYearOptions(), []);

  // Get user's visible sports and sport config
  const { visibleSports, isLoading: prefsLoading } = useVisibleSports();
  const { sportConfig, isLoading: configLoading } = useSportConfig();

  // Determine which sports to include based on filter mode
  const allSports = useMemo(() => {
    if (!sportConfig?.sport_categories) {
      return ["cycling", "running", "yoga"]; // Fallback
    }
    return Object.keys(sportConfig.sport_categories);
  }, [sportConfig]);

  const validVisibleSports = useMemo(
    () => filterValidSports(visibleSports, sportConfig),
    [visibleSports, sportConfig]
  );

  const activeSports = sportFilter === "all" ? allSports : validVisibleSports;

  // Calculate date range based on selected option
  const { startDate, endDate, from, to } = useMemo(() => getDateRange(timeRange), [timeRange]);

  // Fetch daily data for selected sports
  // Note: year param is used for URL path, but from/to params filter the actual data
  const {
    data,
    isLoading: dataLoading,
    error,
  } = useDailySportData({
    year: currentYear,
    from,
    to,
    sports: activeSports,
  });

  const isLoading = prefsLoading || configLoading || dataLoading;

  // Build activity count map: date -> total activities across selected sports
  const activityCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    activeSports.forEach((sport) => {
      const sportData = data[sport];
      if (sportData) {
        Object.entries(sportData).forEach(([date, activity]) => {
          counts[date] = (counts[date] || 0) + activity.activities;
        });
      }
    });

    return counts;
  }, [data, activeSports]);

  // Generate calendar weeks for the date range
  const weeks = useMemo(() => generateWeeksForRange(startDate, endDate), [startDate, endDate]);
  const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

  // Calculate total activities in range
  const totalActivities = useMemo(() => {
    return Object.values(activityCounts).reduce((sum, count) => sum + count, 0);
  }, [activityCounts]);

  // Label for time range
  const rangeLabel = timeRange === "trailing12" ? "past 12 months" : String(timeRange);

  // Dropdown handler
  const handleTimeRangeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "trailing12") {
      setTimeRange("trailing12");
    } else {
      setTimeRange(parseInt(value, 10));
    }
  };

  if (isLoading) {
    return (
      <div className={className}>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h2 className="h6 mb-0 text-muted">Activity Calendar</h2>
        </div>
        <div
          className="glass-panel d-flex align-items-center justify-content-center"
          style={{ height: 120 }}
        >
          <NeonSpinner size="sm" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${className} text-center p-4`}>
        <p className="text-danger mb-0 small">Failed to load calendar data</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="h6 mb-0 text-muted">
          Activity Calendar
          <span className="ms-2 small fw-normal">
            {totalActivities} activities in {rangeLabel}
          </span>
        </h2>
        <div className="d-flex align-items-center gap-2">
          {/* Sport filter toggle */}
          <div className="btn-group btn-group-sm" role="group" aria-label="Sport filter">
            <button
              type="button"
              className={`btn btn-outline-secondary py-0 px-2 ${sportFilter === "all" ? "active" : ""}`}
              style={{ fontSize: "0.7rem" }}
              onClick={() => setSportFilter("all")}
              aria-pressed={sportFilter === "all"}
            >
              All
            </button>
            <button
              type="button"
              className={`btn btn-outline-secondary py-0 px-2 ${sportFilter === "visible" ? "active" : ""}`}
              style={{ fontSize: "0.7rem" }}
              onClick={() => setSportFilter("visible")}
              aria-pressed={sportFilter === "visible"}
              title={`Show only: ${validVisibleSports.join(", ")}`}
            >
              Visible
            </button>
          </div>
          {/* Time range selector */}
          <select
            className="form-select form-select-sm"
            style={{ width: "auto", fontSize: "0.75rem" }}
            value={timeRange === "trailing12" ? "trailing12" : String(timeRange)}
            onChange={handleTimeRangeChange}
            aria-label="Select time range"
          >
            <option value="trailing12">Past 12 months</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="glass-panel overflow-auto d-flex flex-column align-items-center">
        <div
          style={{
            display: "inline-block",
            position: "relative",
            paddingLeft: DAY_LABEL_WIDTH,
            paddingTop: HEADER_HEIGHT,
          }}
        >
          {/* Month labels */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: DAY_LABEL_WIDTH,
              display: "flex",
              fontSize: "9px",
              color: "var(--bs-gray-600)",
              whiteSpace: "nowrap",
            }}
          >
            {monthLabels.map(({ label, weekIndex, showYear, year }) => (
              <div
                key={`${label}-${weekIndex}`}
                style={{
                  position: "absolute",
                  left: weekIndex * (CELL_SIZE + CELL_GAP),
                }}
              >
                {showYear ? `${label} '${String(year).slice(2)}` : label}
              </div>
            ))}
          </div>

          {/* Day labels (Mon, Wed, Fri only for compactness) */}
          <div
            style={{
              position: "absolute",
              top: HEADER_HEIGHT,
              left: 0,
              display: "flex",
              flexDirection: "column",
              fontSize: "9px",
              color: "var(--bs-gray-600)",
              gap: CELL_GAP,
            }}
          >
            {DAY_LABELS.map((label, i) => (
              <div
                key={label}
                style={{
                  height: CELL_SIZE,
                  lineHeight: `${CELL_SIZE}px`,
                  visibility: i % 2 === 1 ? "visible" : "hidden", // Only show Mon, Wed, Fri
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div
            style={{
              display: "flex",
              gap: CELL_GAP,
            }}
          >
            {weeks.map((week, weekIndex) => (
              <div
                key={weekIndex}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: CELL_GAP,
                }}
              >
                {week.map((date, dayIndex) => {
                  if (!date) {
                    return (
                      <div
                        key={dayIndex}
                        style={{
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          background: "transparent",
                        }}
                      />
                    );
                  }

                  const dateStr = toLocalDateString(date);
                  const count = activityCounts[dateStr] || 0;
                  const color = getIntensityColor(count);

                  return (
                    <div
                      key={dateStr}
                      title={`${dateStr}: ${count} ${count === 1 ? "activity" : "activities"}`}
                      style={{
                        width: CELL_SIZE,
                        height: CELL_SIZE,
                        background: color,
                        borderRadius: 2,
                        cursor: "default",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div
          className="d-flex align-items-center justify-content-end gap-1 mt-2"
          style={{ fontSize: "9px", color: "var(--bs-gray-600)" }}
        >
          <span>Less</span>
          {INTENSITY_COLORS.map((color, i) => (
            <div
              key={i}
              style={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                background: color,
                borderRadius: 2,
              }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
