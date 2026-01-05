import { useMemo, useState } from "react";
import { useDailySportData, type Sport } from "../../hooks/useDailySportData";
import NeonSpinner from "../NeonSpinner";

interface ActivityCalendarHeatmapProps {
  className?: string;
}

/** Time range option for the heatmap */
type TimeRangeOption = "trailing12" | number; // "trailing12" or a specific year

/** Color scale for activity intensity (GitHub-style green) */
const INTENSITY_COLORS = [
  "var(--bs-gray-200)", // 0 activities - light gray
  "rgb(155, 233, 168)", // 1 activity - light green
  "rgb(64, 196, 99)", // 2-3 activities - medium green
  "rgb(48, 161, 78)", // 4-5 activities - darker green
  "rgb(33, 110, 57)", // 6+ activities - dark green
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
 * Format a Date as YYYY-MM-DD in local timezone.
 */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get month labels positioned above the calendar.
 * Returns array of { label, weekIndex, year } for months that start in that week.
 */
function getMonthLabels(
  weeks: (Date | null)[][]
): { label: string; weekIndex: number; year?: number }[] {
  const labels: { label: string; weekIndex: number; year?: number }[] = [];
  let lastMonthKey = "";

  weeks.forEach((week, weekIndex) => {
    // Find the first non-null date in the week
    const firstDate = week.find((d) => d !== null);
    if (firstDate) {
      const month = firstDate.getMonth();
      const year = firstDate.getFullYear();
      const monthKey = `${year}-${month}`;
      if (monthKey !== lastMonthKey) {
        // Include year for January or first label
        const includeYear = month === 0 || labels.length === 0;
        labels.push({
          label: includeYear
            ? `${MONTH_LABELS[month]} '${String(year).slice(2)}`
            : MONTH_LABELS[month],
          weekIndex,
          year: includeYear ? year : undefined,
        });
        lastMonthKey = monthKey;
      }
    }
  });

  return labels;
}

/**
 * Calculate date range for a time range option.
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
    // Specific year
    const year = option;
    startDate = new Date(year, 0, 1);
    endDate = today.getFullYear() === year ? today : new Date(year, 11, 31);
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
 */
export default function ActivityCalendarHeatmap({ className = "" }: ActivityCalendarHeatmapProps) {
  const [timeRange, setTimeRange] = useState<TimeRangeOption>("trailing12");
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => getYearOptions(), []);

  // Calculate date range based on selected option
  const { startDate, endDate, from, to } = useMemo(() => getDateRange(timeRange), [timeRange]);

  // Fetch daily data for all sports
  // Note: year param is used for URL path, but from/to params filter the actual data
  const { data, isLoading, error } = useDailySportData({ year: currentYear, from, to });

  // Build activity count map: date -> total activities across all sports
  const activityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const sports: Sport[] = ["cycling", "running", "yoga"];

    sports.forEach((sport) => {
      const sportData = data[sport];
      Object.entries(sportData).forEach(([date, activity]) => {
        counts[date] = (counts[date] || 0) + activity.activities;
      });
    });

    return counts;
  }, [data]);

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
          className="border rounded d-flex align-items-center justify-content-center"
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

  const cellSize = 11;
  const cellGap = 3;
  const dayLabelWidth = 28;
  const headerHeight = 16;

  return (
    <div className={className}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="h6 mb-0 text-muted">
          Activity Calendar
          <span className="ms-2 small fw-normal">
            {totalActivities} activities in {rangeLabel}
          </span>
        </h2>
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

      <div className="border rounded p-2 overflow-auto" style={{ maxWidth: "100%" }}>
        <div
          style={{
            display: "inline-block",
            position: "relative",
            paddingLeft: dayLabelWidth,
            paddingTop: headerHeight,
          }}
        >
          {/* Month labels */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: dayLabelWidth,
              display: "flex",
              fontSize: "9px",
              color: "var(--bs-gray-600)",
            }}
          >
            {monthLabels.map(({ label, weekIndex }) => (
              <div
                key={`${label}-${weekIndex}`}
                style={{
                  position: "absolute",
                  left: weekIndex * (cellSize + cellGap),
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Day labels (Mon, Wed, Fri only for compactness) */}
          <div
            style={{
              position: "absolute",
              top: headerHeight,
              left: 0,
              display: "flex",
              flexDirection: "column",
              fontSize: "9px",
              color: "var(--bs-gray-600)",
              gap: cellGap,
            }}
          >
            {DAY_LABELS.map((label, i) => (
              <div
                key={label}
                style={{
                  height: cellSize,
                  lineHeight: `${cellSize}px`,
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
              gap: cellGap,
            }}
          >
            {weeks.map((week, weekIndex) => (
              <div
                key={weekIndex}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: cellGap,
                }}
              >
                {week.map((date, dayIndex) => {
                  if (!date) {
                    return (
                      <div
                        key={dayIndex}
                        style={{
                          width: cellSize,
                          height: cellSize,
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
                        width: cellSize,
                        height: cellSize,
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
                width: cellSize,
                height: cellSize,
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
