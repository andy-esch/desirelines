// Recharts implementation of PacingMetricsChart
import { memo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import type { DistanceEntry } from "../../types/activity";
import { CHART_COLORS, GOAL_COLORS } from "../../constants/chartColors";
import { CHART_CONFIG } from "../../constants/chartConfig";
import { type Goals } from "../../utils/goalCalculations";
import ChartTooltip from "./ChartTooltip";
import ChartContainer from "./ChartContainer";
import YAxisMarker from "./YAxisMarker";
import { getMetricUnitLabel, type MetricUnit } from "../../utils/units";
import { usePacingChartData } from "../../hooks/usePacingChartData";

interface PacingMetricsChartProps {
  year: number;
  goals: Goals;
  distanceData: DistanceEntry[];
  isLoading: boolean;
  error: Error | null;
  showFullYear?: boolean;
  hideHeader?: boolean;
  unit?: MetricUnit;
  sport?: string;
  onRetry?: () => void;
}

const PacingMetricsChart = (props: PacingMetricsChartProps) => {
  const {
    year,
    goals,
    distanceData,
    isLoading,
    error,
    showFullYear = true,
    hideHeader = false,
    unit = "miles",
    sport = "cycling",
    onRetry,
  } = props;

  const unitLabel = getMetricUnitLabel(unit);
  const chartTitle =
    unit === "sessions" ? "Daily Activity (sessions / day)" : `Daily Pace (${unitLabel} / day)`;

  const {
    startDate,
    displayEndDate,
    pacingGoals,
    mergedData,
    currentValues,
    dangerThreshold,
    naturalYMax,
    shouldShowDangerZone,
  } = usePacingChartData({
    year,
    goals,
    distanceData,
    showFullYear,
    sport,
  });

  return (
    <ChartContainer
      title={chartTitle}
      isLoading={isLoading}
      error={error}
      isEmpty={distanceData.length === 0}
      hideHeader={hideHeader}
      onRetry={onRetry}
      emptyStateConfig={{ sport, year, unit, message: "No pacing data available" }}
      className={hideHeader ? "" : "mt-4"}
    >
      <ResponsiveContainer width="100%" height={CHART_CONFIG.height}>
        <LineChart data={mergedData} margin={CHART_CONFIG.margin} accessibilityLayer>
          <CartesianGrid
            strokeDasharray={CHART_CONFIG.grid.strokeDasharray}
            stroke={CHART_CONFIG.grid.stroke}
            opacity={CHART_CONFIG.grid.opacity}
          />
          <XAxis
            dataKey="date"
            type="number"
            domain={[startDate.getTime(), displayEndDate.getTime()]}
            scale="time"
            tickFormatter={(timestamp) => {
              const date = new Date(timestamp);
              const formatter = new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              });
              return formatter.format(date);
            }}
            stroke={CHART_CONFIG.axis.stroke}
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            label={{
              value: unit === "sessions" ? "# Sessions / Day" : `${unitLabel} / Day`,
              angle: -90,
              position: "insideLeft",
            }}
            domain={[0, naturalYMax]}
            allowDataOverflow={true}
            stroke={CHART_CONFIG.axis.stroke}
            tickFormatter={(value: number) => value.toFixed(1)}
          />
          <Tooltip content={<ChartTooltip unit={`${unitLabel}/day`} decimals={2} />} />

          {/* ZONE OF UNACHIEVABILITY - Only visible when threshold is within natural range */}
          {shouldShowDangerZone && (
            <ReferenceArea
              y1={dangerThreshold}
              y2={naturalYMax}
              fill="rgba(255, 152, 0, 0.08)"
              fillOpacity={0.5}
              stroke="rgba(255, 152, 0, 0.3)"
              strokeDasharray="3 3"
            />
          )}

          {/* Threshold line at danger zone boundary with label */}
          {shouldShowDangerZone && (
            <ReferenceLine
              y={dangerThreshold}
              stroke="#ff9800"
              strokeWidth={2}
              strokeDasharray="5 5"
              label={{
                value: `Zone of Unachievability (${dangerThreshold} ${unitLabel}/day)`,
                position: "insideTopLeft",
                fill: "#e65100",
                fontSize: 12,
                fontWeight: 600,
                fontStyle: "italic",
                offset: 5,
              }}
            />
          )}

          {/* Y-axis markers for current values */}
          <YAxisMarker
            value={currentValues.actual}
            label="Actual"
            color={CHART_COLORS.ACTUAL_DATA_LINE}
            fontSize={CHART_CONFIG.marker.fontSize.actual}
            fontWeight="bold"
          />
          {currentValues.goals.map((goal, index) => (
            <YAxisMarker
              key={index}
              value={goal.value}
              label={goal.label || "Goal"}
              color={goal.color}
            />
          ))}

          {/* Actual pacing */}
          <Line
            type="monotone"
            dataKey="actual"
            stroke={CHART_COLORS.ACTUAL_DATA_LINE}
            strokeWidth={CHART_CONFIG.strokeWidth.actual}
            dot={false}
            name={`${year} Pacing Data`}
            animationDuration={CHART_CONFIG.animation.duration}
          />

          {/* Pacing goal lines */}
          {pacingGoals.map((pg, index) => (
            <Line
              key={pg.goal.id}
              type="monotone"
              dataKey={`goal${index}`}
              stroke={GOAL_COLORS[index % GOAL_COLORS.length]}
              strokeWidth={CHART_CONFIG.strokeWidth.goal}
              dot={false}
              name={`${pg.goal.label || "Goal"} Pacing: ${pg.goal.value} ${unitLabel}`}
              animationDuration={CHART_CONFIG.animation.duration}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
};

export default memo(PacingMetricsChart);
