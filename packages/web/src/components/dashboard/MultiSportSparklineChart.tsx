import { Link } from "@tanstack/react-router";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { parseLocalDateStrict } from "../../utils/dateUtils";
import {
  convertDistance,
  getDistanceLabel,
  formatHoursMinutes,
  type DistanceUnit,
} from "../../utils/units";
import { SkeletonRegion, SparklineSkeleton } from "../Skeleton";
import { ErrorState } from "../ErrorState";
import { useMultiSportChartData } from "../../hooks/useMultiSportChartData";
import type { TuningParams } from "../../utils/demoDataGenerator";
import type { TimeRange } from "../../utils/dataNormalization";
import { MissingValue } from "../theme/MissingValue";
import { Panel } from "../theme/Panel";
import { useThemeDateFormat } from "../theme/useThemeDateFormat";
import ChartTooltipFrame from "../charts/ChartTooltipFrame";
import { cn } from "@/lib/utils";

interface MultiSportSparklineChartProps {
  timeRange: TimeRange;
  className?: string | undefined;
  tuningParams?: TuningParams | undefined;
}

interface SportMetaItem {
  sport: string;
  displayName: string;
  color: string;
  lastActivityYear: number;
  isDistanceSport: boolean;
  isTimeSport: boolean;
}

/**
 * Format date for x-axis tick (e.g., "Dec 15", or "12.15" where the theme spells dates that
 * way). Uses parseLocalDateStrict to avoid UTC conversion issues. Takes the formatter rather
 * than reading the theme itself: this is called as a chart tick formatter, outside React.
 */
function formatAxisDate(dateStr: string, formatDate: (date: Date) => string): string {
  return formatDate(parseLocalDateStrict(dateStr));
}

/**
 * An axis label that stays inside the plot.
 *
 * Recharts centres every tick on its position, so the first and last labels hang half their
 * width past the ends of the lines they describe. Anchoring the outer two to their own edge
 * keeps the row of dates within the same x-range as the sparklines.
 *
 * Recharts clones this element with the tick's geometry, so the props arrive from there
 * rather than from the caller.
 */
function ClampedAxisTick({
  x,
  y,
  payload,
  index,
  visibleTicksCount,
  formatDate,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  index?: number;
  visibleTicksCount?: number;
  formatDate: (date: Date) => string;
}) {
  const last = (visibleTicksCount ?? 0) - 1;
  const anchor = index === 0 ? "start" : index === last ? "end" : "middle";
  return (
    <text
      x={x}
      y={y}
      dy={10}
      textAnchor={anchor}
      fontSize={9}
      fill="var(--color-chart-tick)"
      fontFamily="var(--font-chart)"
    >
      {payload?.value ? formatAxisDate(payload.value, formatDate) : ""}
    </text>
  );
}

interface TooltipPayloadItem {
  dataKey?: string | number | undefined;
  value?: number | undefined;
  payload?: Record<string, number | string> | undefined;
}

interface UnifiedSparklineTooltipProps {
  active?: boolean | undefined;
  payload?: readonly TooltipPayloadItem[] | undefined;
  label?: string | undefined;
  sportMeta: SportMetaItem[];
  distanceUnit: DistanceUnit;
}

/**
 * Format a raw metric value for display in tooltip.
 * Distance sports show converted value with unit (e.g., "5.2 mi").
 * Time sports show a duration (e.g., "45 min").
 * Session-based sports show the count (e.g., "2 sessions"). A day without the sport has no
 * value: null.
 */
function formatMetricValue(
  rawValue: number,
  isDistance: boolean,
  isTime: boolean,
  distanceUnit: DistanceUnit
): string | null {
  if (rawValue === 0) return null;

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

  // Session-based: a whole count
  const sessions = Math.round(rawValue);
  return `${sessions} session${sessions === 1 ? "" : "s"}`;
}

/**
 * Custom tooltip for unified sparkline chart, in the shared ChartTooltipFrame.
 * Shows date and actual metric values with colored indicators.
 */
function UnifiedSparklineTooltip({
  active,
  payload,
  label,
  sportMeta,
  distanceUnit,
}: UnifiedSparklineTooltipProps) {
  const { formatDate } = useThemeDateFormat();
  if (!active || !payload || payload.length === 0 || !label) return null;

  const date = parseLocalDateStrict(label);
  const formattedDate = formatDate(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  // Get raw values from the payload's data entry
  const dataEntry = payload[0]?.payload ?? {};

  return (
    <ChartTooltipFrame title={formattedDate} tone="caption" minWidth={110}>
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
                borderRadius: "var(--sport-mark-radius)",
                background: meta.color,
                // The tooltip surface is near-white in light mode, where several sport
                // colors sit close to 1:1 against it.
                boxShadow: "0 0 0 1px var(--color-chart-mark-outline)",
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
              {formatMetricValue(
                rawValue,
                meta.isDistanceSport,
                meta.isTimeSport,
                distanceUnit
              ) ?? <MissingValue />}
            </span>
          </div>
        );
      })}
    </ChartTooltipFrame>
  );
}

/**
 * Legend showing sport names with links to sport pages.
 *
 * The label wears a neutral text token, never the series color: a darkened spectrum
 * color was unreadable on the light ground (the same neon-as-text failure fixed on
 * the sport chips). The colored dash beside it carries the identity, so the pairing
 * still reads — and `text-body-text` is needed explicitly here because the global
 * `a` rule would otherwise tint these links accent-cyan.
 */
function SparklineLegend({ sportMeta }: { sportMeta: SportMetaItem[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2" style={{ fontSize: "0.75rem" }}>
      {sportMeta.map(({ sport, displayName, color, lastActivityYear }) => (
        <Link
          key={sport}
          to="/$sport/$year"
          params={{ sport, year: String(lastActivityYear) }}
          className="flex items-center gap-1 text-body-text"
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
  const { formatDate } = useThemeDateFormat();
  const {
    unifiedChartData,
    sportMeta,
    validSports,
    distanceUnit,
    isLoading,
    error,
    retry,
    sparklineContainerHeight,
    SPARKLINE_ROW_HEIGHT,
  } = useMultiSportChartData(timeRange, tuningParams);

  // Calculate chart height based on number of sports (min 100px, max 180px)
  const chartHeight = Math.min(180, Math.max(100, validSports.length * 30 + 20));

  if (isLoading) {
    return (
      <Panel className={cn("h-full", className)} bodyClassName="flex flex-1 flex-col p-2">
        <SkeletonRegion
          label="Loading chart data"
          className="flex flex-1 flex-col justify-center gap-2"
          style={{ minHeight: sparklineContainerHeight }}
        >
          <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
          <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
          <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
          <SparklineSkeleton rowHeight={SPARKLINE_ROW_HEIGHT} />
        </SkeletonRegion>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel className={className} bodyClassName="p-4" tone="danger">
        <ErrorState title="Error loading chart data" onRetry={retry}>
          {error.message}
        </ErrorState>
      </Panel>
    );
  }

  return (
    <Panel className={cn("h-full", className)} bodyClassName="flex flex-1 flex-col p-2">
      {/* Legend with sport links. */}
      <SparklineLegend sportMeta={sportMeta} />

      {/* Unified chart — grows to fill available height */}
      <div className="grow" style={{ minHeight: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={50}>
          <LineChart data={unifiedChartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={<ClampedAxisTick formatDate={formatDate} />}
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
                stroke: "var(--color-chart-axis)",
                strokeWidth: 1,
              }}
            />
            {/* Casings first, so every sport's line draws over all of them. A theme on a light
                ground edges its lines in ink; on a dark one the casing is transparent. */}
            {sportMeta.map(({ sport }) => (
              <Line
                key={`${sport}-casing`}
                type="linear"
                dataKey={sport}
                stroke="var(--color-chart-line-casing)"
                strokeWidth={3.5}
                dot={false}
                activeDot={false}
                legendType="none"
                tooltipType="none"
                isAnimationActive={false}
              />
            ))}
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
    </Panel>
  );
}
