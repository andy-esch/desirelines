import { Link } from "@tanstack/react-router";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { parseLocalDateStrict, formatDisplayDate } from "../../utils/dateUtils";
import {
  convertDistance,
  getDistanceLabel,
  formatHoursMinutes,
  type DistanceUnit,
} from "../../utils/units";
import { SparklineSkeleton } from "../Skeleton";
import { useMultiSportChartData } from "../../hooks/useMultiSportChartData";
import type { TuningParams } from "../../utils/demoDataGenerator";
import type { TimeRange } from "../../utils/dataNormalization";

interface MultiSportSparklineChartProps {
  timeRange: TimeRange;
  className?: string;
  tuningParams?: TuningParams;
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
  payload?: readonly TooltipPayloadItem[];
  label?: string;
  sportMeta: SportMetaItem[];
  distanceUnit: DistanceUnit;
}

/**
 * Format a raw metric value for display in tooltip.
 * Distance sports show converted value with unit (e.g., "5.2 mi").
 * Time sports show minutes (e.g., "45 min").
 * Session-based sports show just the count.
 */
function formatMetricValue(
  rawValue: number,
  isDistance: boolean,
  isTime: boolean,
  distanceUnit: DistanceUnit
): string {
  if (rawValue === 0) return "-";

  if (isDistance) {
    const converted = convertDistance(rawValue, distanceUnit);
    const label = getDistanceLabel(distanceUnit);
    // Show 1 decimal for values >= 10, otherwise show more precision
    const decimals = converted >= 10 ? 1 : 2;
    return `${converted.toFixed(decimals)} ${label}`;
  }

  if (isTime) {
    // Time-based: convert minutes from API to hours for display
    const hours = rawValue / 60;
    return formatHoursMinutes(hours);
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
  distanceUnit,
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
        background: "var(--color-chart-tooltip-bg)",
        border: "1px solid var(--color-chart-tooltip-border)",
        fontSize: "0.75rem",
        minWidth: 110,
        backdropFilter: "blur(4px)",
      }}
    >
      <div className="mb-1" style={{ color: "var(--color-chart-tooltip-muted)", fontWeight: 500 }}>
        {formattedDate}
      </div>
      {sportMeta.map((meta) => {
        const rawValue = (dataEntry[`${meta.sport}_raw`] as number) ?? 0;
        const hasActivity = rawValue > 0;

        return (
          <div
            key={meta.sport}
            className="flex items-center gap-2"
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
            <span style={{ color: "var(--color-chart-tooltip-text)" }}>{meta.displayName}</span>
            <span
              style={{
                color: hasActivity
                  ? "var(--color-chart-tooltip-text)"
                  : "var(--color-chart-tooltip-label)",
                marginLeft: "auto",
                fontWeight: hasActivity ? 500 : 400,
              }}
            >
              {formatMetricValue(rawValue, meta.isDistanceSport, meta.isTimeSport, distanceUnit)}
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
    <div className="flex flex-wrap gap-2 mb-2" style={{ fontSize: "0.75rem" }}>
      {sportMeta.map(({ sport, displayName, color, textColor, lastActivityYear }) => (
        <Link
          key={sport}
          to="/$sport/$year"
          params={{ sport, year: String(lastActivityYear) }}
          className="flex items-center gap-1"
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

/**
 * Unified multi-sport sparkline chart.
 * Shows activity trends for all visible sports in a single normalized view.
 */
export default function MultiSportSparklineChart({
  timeRange,
  className = "",
  tuningParams,
}: MultiSportSparklineChartProps) {
  const {
    unifiedChartData,
    sportMeta,
    validSports,
    distanceUnit,
    isLoading,
    error,
    sparklineContainerHeight,
    SPARKLINE_ROW_HEIGHT,
  } = useMultiSportChartData(timeRange, tuningParams);

  // Calculate chart height based on number of sports (min 100px, max 180px)
  const chartHeight = Math.min(180, Math.max(100, validSports.length * 30 + 20));

  if (isLoading) {
    return (
      <div
        className={`glass-panel h-full flex flex-col justify-center gap-2 ${className}`}
        style={{ minHeight: sparklineContainerHeight }}
        role="status"
        aria-label="Loading chart data"
      >
        <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
        <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
        <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
        <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`glass-panel ${className} text-center p-6`}>
        <p className="text-danger mb-0">Failed to load chart data</p>
      </div>
    );
  }

  return (
    <div className={`glass-panel h-full flex flex-col ${className}`} style={{ minWidth: 0 }}>
      {/* Legend with sport links */}
      <SparklineLegend sportMeta={sportMeta} />

      {/* Unified chart — grows to fill available height */}
      <div className="grow" style={{ minHeight: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={50}>
          <LineChart data={unifiedChartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
              tickFormatter={formatAxisDate}
              interval="preserveStartEnd"
              minTickGap={50}
            />
            <YAxis domain={[0, 1]} hide />
            <Tooltip
              content={({ active, payload, label }) => (
                <UnifiedSparklineTooltip
                  active={active}
                  payload={payload as readonly TooltipPayloadItem[] | undefined}
                  label={label as string | undefined}
                  sportMeta={sportMeta}
                  distanceUnit={distanceUnit}
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
  );
}
