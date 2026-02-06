import { Link } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { parseLocalDateStrict, formatDisplayDate } from "../../utils/dateUtils";
import { convertDistance, getDistanceLabel, DEFAULT_USER_SETTINGS } from "../../utils/units";
import TimeRangeSelector from "./TimeRangeSelector";
import RecentActivitiesList from "./RecentActivitiesList";
import { SparklineSkeleton, ActivityRowSkeleton } from "../Skeleton";
import { useMultiSportChartData } from "../../hooks/useMultiSportChartData";

interface MultiSportComparisonChartProps {
  className?: string;
}

interface SportMetaItem {
  sport: string;
  displayName: string;
  color: string;
  textColor: string;
  lastActivityYear: number;
  isDistanceSport: boolean;
  isTimeSport: boolean;
}

/**
 * Format date for x-axis tick (e.g., "Dec 15").
 * Uses parseLocalDateStrict to avoid UTC conversion issues.
 */
function formatAxisDate(dateStr: string): string {
  const date = parseLocalDateStrict(dateStr);
  return formatDisplayDate(date);
}

interface TooltipPayloadItem {
  dataKey?: string | number;
  value?: number;
  payload?: Record<string, number | string>;
}

interface UnifiedSparklineTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  sportMeta: SportMetaItem[];
}

/**
 * Format a raw metric value for display in tooltip.
 * Distance sports show converted value with unit (e.g., "5.2 mi").
 * Time sports show minutes (e.g., "45 min").
 * Session-based sports show just the count.
 */
function formatMetricValue(rawValue: number, isDistance: boolean, isTime: boolean): string {
  if (rawValue === 0) return "-";

  if (isDistance) {
    // Convert meters to user's preferred unit
    const unit = DEFAULT_USER_SETTINGS.distanceUnit;
    const converted = convertDistance(rawValue, unit);
    const label = getDistanceLabel(unit);
    // Show 1 decimal for values >= 10, otherwise show more precision
    const decimals = converted >= 10 ? 1 : 2;
    return `${converted.toFixed(decimals)} ${label}`;
  }

  if (isTime) {
    // Time-based: show minutes with 0 or 1 decimal
    const decimals = rawValue >= 10 ? 0 : 1;
    return `${rawValue.toFixed(decimals)} min`;
  }

  // Session-based: show as integer
  return Math.round(rawValue).toString();
}

/**
 * Custom tooltip for unified sparkline chart.
 * Shows date and actual metric values with colored indicators.
 * Semi-transparent background to avoid occluding chart lines.
 */
function UnifiedSparklineTooltip({
  active,
  payload,
  label,
  sportMeta,
}: UnifiedSparklineTooltipProps) {
  if (!active || !payload || payload.length === 0 || !label) return null;

  const date = parseLocalDateStrict(label);
  const formattedDate = formatDisplayDate(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  // Get raw values from the payload's data entry
  const dataEntry = payload[0]?.payload ?? {};

  return (
    <div
      className="rounded shadow-sm p-2"
      style={{
        background: "rgba(255, 255, 255, 0.92)",
        border: "1px solid rgba(0, 0, 0, 0.15)",
        fontSize: "0.75rem",
        minWidth: 110,
        backdropFilter: "blur(4px)",
      }}
    >
      <div className="mb-1" style={{ color: "#666", fontWeight: 500 }}>
        {formattedDate}
      </div>
      {sportMeta.map((meta) => {
        const rawValue = (dataEntry[`${meta.sport}_raw`] as number) ?? 0;
        const hasActivity = rawValue > 0;

        return (
          <div
            key={meta.sport}
            className="d-flex align-items-center gap-2"
            style={{ opacity: hasActivity ? 1 : 0.4 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: meta.color,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#444" }}>{meta.displayName}</span>
            <span
              style={{
                color: hasActivity ? "#000" : "#999",
                marginLeft: "auto",
                fontWeight: hasActivity ? 500 : 400,
              }}
            >
              {formatMetricValue(rawValue, meta.isDistanceSport, meta.isTimeSport)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Legend showing sport names with links to sport pages.
 */
function SparklineLegend({ sportMeta }: { sportMeta: SportMetaItem[] }) {
  return (
    <div className="d-flex flex-wrap gap-2 mb-2" style={{ fontSize: "0.75rem" }}>
      {sportMeta.map(({ sport, displayName, color, textColor, lastActivityYear }) => (
        <Link
          key={sport}
          to={`/${sport}/${lastActivityYear}`}
          className="d-flex align-items-center gap-1 text-decoration-none"
          style={{ color: textColor }}
          title={displayName}
        >
          <span
            style={{
              width: 12,
              height: 3,
              background: color,
              borderRadius: 1,
            }}
          />
          <span style={{ fontWeight: 500 }}>{displayName}</span>
        </Link>
      ))}
    </div>
  );
}

export default function MultiSportComparisonChart({
  className = "",
}: MultiSportComparisonChartProps) {
  const {
    timeRange,
    setTimeRange,
    unifiedChartData,
    sportMeta,
    validSports,
    isLoading,
    error,
    activityPageSize,
    sparklineContainerHeight,
    hasAnyData,
    SPARKLINE_ROW_HEIGHT,
  } = useMultiSportChartData();

  // Calculate chart height based on number of sports (min 120px, max 200px)
  const chartHeight = Math.min(200, Math.max(120, validSports.length * 30 + 40));

  if (isLoading) {
    return (
      <div className={className}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h5 mb-0">Recent Activity</h2>
          {/* Placeholder for TimeRangeSelector to prevent layout shift */}
          <div style={{ width: 120, height: 31 }} />
        </div>

        {/* Two-column skeleton layout - matches loaded state structure */}
        <div
          className="row g-3 justify-content-center"
          role="status"
          aria-label="Loading activity data"
        >
          {/* Left: Sparkline skeletons */}
          <div className="col-md-6" style={{ minWidth: 0, overflow: "hidden" }}>
            <div
              className="glass-panel h-100 d-flex flex-column justify-content-center gap-2"
              style={{ minHeight: sparklineContainerHeight }}
            >
              {/* Show 4 skeleton rows to approximate typical sport count */}
              <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
              <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
              <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
              <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
            </div>
          </div>

          {/* Right: Activity list skeletons */}
          <div className="col-md-6">
            <div
              className="glass-panel h-100 overflow-hidden"
              style={{ minHeight: sparklineContainerHeight }}
            >
              <div className="d-flex flex-column gap-1">
                <ActivityRowSkeleton />
                <ActivityRowSkeleton />
                <ActivityRowSkeleton />
                <ActivityRowSkeleton />
                <ActivityRowSkeleton />
              </div>
            </div>
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

  return (
    <div className={className}>
      {/* Header with time range selector */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="h5 mb-0">Recent Activity</h2>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      {!hasAnyData ? (
        <div
          className="glass-panel d-flex align-items-center justify-content-center"
          style={{ height: sparklineContainerHeight }}
        >
          <p className="text-muted mb-0">No activity data for selected time range</p>
        </div>
      ) : (
        <div className="row g-3 justify-content-center">
          {/* Left: Unified Sparkline Chart */}
          <div className="col-md-6" style={{ minWidth: 0, overflow: "hidden" }}>
            <div
              className="glass-panel h-100"
              style={{
                minHeight: sparklineContainerHeight,
                minWidth: 0,
              }}
            >
              {/* Legend with sport links */}
              <SparklineLegend sportMeta={sportMeta} />

              {/* Unified chart with all sports */}
              <div style={{ height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={50}>
                  <LineChart
                    data={unifiedChartData}
                    margin={{ top: 8, right: 8, bottom: 20, left: 8 }}
                  >
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 9, fill: "#999" }}
                      tickFormatter={formatAxisDate}
                      interval="preserveStartEnd"
                      minTickGap={50}
                    />
                    <YAxis domain={[0, 1]} hide />
                    <Tooltip
                      content={({ active, payload, label }) => (
                        <UnifiedSparklineTooltip
                          active={active}
                          payload={payload as TooltipPayloadItem[] | undefined}
                          label={label as string | undefined}
                          sportMeta={sportMeta}
                        />
                      )}
                      cursor={{
                        stroke: "rgba(100, 100, 100, 0.5)",
                        strokeWidth: 1,
                      }}
                    />
                    {sportMeta.map(({ sport, color }) => (
                      <Line
                        key={sport}
                        type="linear"
                        dataKey={sport}
                        stroke={color}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Right: Recent Activities */}
          <div className="col-md-6">
            <div
              className="glass-panel h-100 overflow-hidden"
              style={{ minHeight: sparklineContainerHeight }}
            >
              <RecentActivitiesList timeRange={timeRange} pageSize={activityPageSize} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
