import { Link } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis } from "recharts";
import { parseLocalDateStrict, formatDisplayDate } from "../../utils/dateUtils";
import TimeRangeSelector from "./TimeRangeSelector";
import NeonSpinner from "../NeonSpinner";
import RecentActivitiesList from "./RecentActivitiesList";
import { useMultiSportChartData } from "../../hooks/useMultiSportChartData";

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
  rowHeight,
  xAxisHeight,
}: {
  sport: string;
  displayName: string;
  data: { date: string; value: number }[];
  color: string;
  textColor: string;
  showXAxis?: boolean;
  rowHeight: number;
  xAxisHeight: number;
}) {
  const hasData = data.length > 0;
  const currentYear = new Date().getFullYear();

  // Link to the year with most recent activity (data is sorted by date)
  // Falls back to current year if no data
  const linkYear = hasData ? parseInt(data[data.length - 1].date.split("-")[0], 10) : currentYear;

  // Height is taller when showing x-axis (need room for axis labels)
  const chartHeight = showXAxis ? rowHeight + xAxisHeight : rowHeight;

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

export default function MultiSportComparisonChart({
  className = "",
}: MultiSportComparisonChartProps) {
  const {
    timeRange,
    setTimeRange,
    sparklineData,
    validSports,
    isLoading,
    error,
    activityPageSize,
    sparklineContainerHeight,
    hasAnyData,
    MAX_SPORTS_DISPLAY,
    SPARKLINE_ROW_HEIGHT,
    SPARKLINE_XAXIS_HEIGHT,
  } = useMultiSportChartData();

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
                  rowHeight={SPARKLINE_ROW_HEIGHT}
                  xAxisHeight={SPARKLINE_XAXIS_HEIGHT}
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
