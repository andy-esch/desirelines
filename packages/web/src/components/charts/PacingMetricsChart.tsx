// Recharts implementation of PacingMetricsChart
import { useMemo } from "react";
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
import LoadingChart from "./LoadingChart";
import ErrorChart from "./ErrorChart";
import EmptyState from "../EmptyState";
import {
  calculateActualPacing,
  calculateDynamicPacingGoal,
  type Goals,
} from "../../utils/goalCalculations";
import ChartTooltip from "./ChartTooltip";
import { getDistanceLabel, type DistanceUnit, type MetricUnit } from "../../utils/units";
import { getDangerThreshold } from "../../constants/dangerZoneThresholds";

interface PacingMetricsChartProps {
  year: number;
  goals: Goals;
  onGoalsChange?: (goals: Goals) => void;
  distanceData: DistanceEntry[];
  isLoading: boolean;
  error: Error | null;
  showFullYear?: boolean;
  hideHeader?: boolean;
  unit?: MetricUnit; // Unit for metric display (default: "miles", can be "sessions" for yoga)
  sport?: string; // Sport type for danger zone threshold lookup
}

// Removed CustomTooltip - now using shared ChartTooltip component

// Helper to get unit label for both distance and activity metrics
function getUnitLabel(unit: MetricUnit): string {
  // If it's a known distance unit, use getDistanceLabel
  if (unit === "miles" || unit === "kilometers" || unit === "meters") {
    return getDistanceLabel(unit as DistanceUnit);
  }
  // Otherwise, return as-is (e.g., "sessions" for yoga)
  return unit;
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
    unit = "miles", // Default to miles if not provided
    sport = "cycling", // Default to cycling if not provided
  } = props;

  // Determine chart title based on metric type
  const chartTitle =
    unit === "sessions"
      ? "Daily Activity (sessions / day)"
      : `Daily Pace (${getUnitLabel(unit)} / day)`;

  // Derive values from distanceData
  const latestDate = useMemo(() => {
    if (distanceData.length === 0) return new Date();
    const lastEntry = distanceData[distanceData.length - 1];
    return new Date(lastEntry?.x || new Date());
  }, [distanceData]);

  // Calculate year boundaries
  const startDate = useMemo(() => new Date(year, 0, 1), [year]);
  const endDate = useMemo(() => new Date(year, 11, 31), [year]);

  // Use either full year or current date based on toggle
  const displayEndDate = showFullYear ? endDate : latestDate;

  const actualPacing = useMemo(() => {
    if (distanceData.length === 0) return [];
    return calculateActualPacing(distanceData, displayEndDate);
  }, [distanceData, displayEndDate]);

  // Calculate dynamic pacing goals (must be before early returns per React hooks rules)
  const pacingGoals = useMemo(
    () =>
      (goals || []).map((goal) => ({
        goal,
        pacing: calculateDynamicPacingGoal(distanceData, goal.value, year, displayEndDate),
      })),
    [goals, distanceData, year, displayEndDate]
  );

  // Merge all pacing data into a single array for Recharts
  const mergedData = useMemo(() => {
    const dataMap = new Map<number, Record<string, number | Date>>();

    // Add actual pacing data
    actualPacing.forEach((point) => {
      dataMap.set(new Date(point.x).getTime(), {
        date: new Date(point.x),
        actual: point.y,
      });
    });

    // Add pacing goal lines
    pacingGoals.forEach((pg, index) => {
      pg.pacing.forEach((point) => {
        const timestamp = new Date(point.x).getTime();
        const existing = dataMap.get(timestamp) || { date: new Date(point.x) };
        dataMap.set(timestamp, {
          ...existing,
          [`goal${index}`]: point.y,
        });
      });
    });

    // Convert map to sorted array
    return Array.from(dataMap.values()).sort(
      (a, b) => (a.date as Date).getTime() - (b.date as Date).getTime()
    );
  }, [actualPacing, pacingGoals]);

  // Get current values (at the latest date with actual data, not display end date)
  const latestActualData = mergedData.find(
    (d) => d.actual !== undefined && typeof d.actual === "number" && d.actual > 0
  );
  const latestDataIndex =
    distanceData.length > 0
      ? mergedData.findIndex(
          (d) => d.date && new Date(d.date as Date).getTime() === latestDate.getTime()
        )
      : mergedData.length - 1;
  const currentActualData = latestDataIndex >= 0 ? mergedData[latestDataIndex] : latestActualData;

  const currentValues = {
    actual: (currentActualData?.actual as number) || 0,
    goals: pacingGoals.map((pg, index) => {
      const goalValue = currentActualData?.[`goal${index}`] as number;
      return {
        label: pg.goal.label,
        value: goalValue || 0,
        color: GOAL_COLORS[index % GOAL_COLORS.length],
      };
    }),
  };

  // Danger zone logic - adaptive visibility based on natural Y-axis range
  const dangerThreshold = useMemo(() => getDangerThreshold(sport), [sport]);

  // Calculate natural Y-axis max from data only (don't force zone visibility)
  // Cap at reasonable max to prevent infinite Y-axis expansion for unrealistic goals
  const naturalYMax = useMemo(() => {
    const maxPace = Math.max(
      ...pacingGoals.flatMap((pg) => pg.pacing.map((p) => p.y)),
      currentValues.actual,
      0 // Ensure at least 0 if no data
    );

    // Cap the Y-axis at 3x the danger threshold
    // This prevents the chart from expanding infinitely for unrealistic goals
    // while still showing goals that are challenging but potentially achievable
    const reasonableMax = dangerThreshold * 3;
    const cappedMax = Math.min(maxPace, reasonableMax);

    return cappedMax * 1.1; // 10% padding above highest data point
  }, [pacingGoals, currentValues.actual, dangerThreshold]);

  // Only show danger zone if threshold is within natural range
  // (let zone "emerge" as goal lines approach threshold)
  const shouldShowDangerZone = useMemo(() => {
    return dangerThreshold <= naturalYMax;
  }, [dangerThreshold, naturalYMax]);

  // Early returns for loading/error states (must be after all hooks)
  if (isLoading) {
    return (
      <div className={hideHeader ? "" : "mt-4"}>
        {!hideHeader && (
          <h3 className="text-muted mb-3" style={{ fontSize: "1rem", fontWeight: "500" }}>
            {chartTitle}
          </h3>
        )}
        <LoadingChart />
      </div>
    );
  }

  if (error) {
    return (
      <div className={hideHeader ? "" : "mt-4"}>
        {!hideHeader && (
          <h3 className="text-muted mb-3" style={{ fontSize: "1rem", fontWeight: "500" }}>
            {chartTitle}
          </h3>
        )}
        <ErrorChart error={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  // Empty state - no data available (not loading, no error)
  if (distanceData.length === 0) {
    return (
      <div className={hideHeader ? "" : "mt-4"}>
        {!hideHeader && (
          <h3 className="text-muted mb-3" style={{ fontSize: "1rem", fontWeight: "500" }}>
            {chartTitle}
          </h3>
        )}
        <EmptyState sport={sport} year={year} unit={unit} message="No pacing data available" />
      </div>
    );
  }

  return (
    <div className={hideHeader ? "" : "mt-4"}>
      {!hideHeader && (
        <h3 className="text-muted mb-3" style={{ fontSize: "1rem", fontWeight: "500" }}>
          Daily Pace (miles/day)
        </h3>
      )}
      <ResponsiveContainer width="100%" height={CHART_CONFIG.height}>
        <LineChart data={mergedData} margin={CHART_CONFIG.margin}>
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
              const month = date.toLocaleDateString("en-US", { month: "short" });
              const day = date.getDate();
              return `${month} ${day}`;
            }}
            stroke={CHART_CONFIG.axis.stroke}
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            label={{
              value: unit === "sessions" ? "# Sessions / Day" : `${getUnitLabel(unit)} / Day`,
              angle: -90,
              position: "insideLeft",
            }}
            domain={[0, naturalYMax]}
            stroke={CHART_CONFIG.axis.stroke}
            tickFormatter={(value: number) => value.toFixed(1)}
          />
          <Tooltip content={<ChartTooltip unit={`${getUnitLabel(unit)}/day`} decimals={2} />} />

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
                value: `Zone of Unachievability (${dangerThreshold} ${getUnitLabel(unit)}/day)`,
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
          <ReferenceLine
            y={currentValues.actual}
            stroke="transparent"
            label={(props) => {
              const { viewBox } = props;
              return (
                <g>
                  <circle
                    cx={viewBox.x}
                    cy={viewBox.y}
                    r={CHART_CONFIG.marker.radius}
                    fill={CHART_COLORS.ACTUAL_DATA_LINE}
                  />
                  <text
                    x={viewBox.x + 10}
                    y={viewBox.y}
                    textAnchor="start"
                    fill={CHART_COLORS.ACTUAL_DATA_LINE}
                    fontSize={CHART_CONFIG.marker.fontSize.actual}
                    fontWeight="bold"
                    dominantBaseline="middle"
                  >
                    Actual
                  </text>
                </g>
              );
            }}
          />
          {currentValues.goals.map((goal, index) => (
            <ReferenceLine
              key={index}
              y={goal.value}
              stroke="transparent"
              label={(props) => {
                const { viewBox } = props;
                const labelText = goal.label || "Goal";
                return (
                  <g>
                    <circle
                      cx={viewBox.x}
                      cy={viewBox.y}
                      r={CHART_CONFIG.marker.radius}
                      fill={goal.color}
                    />
                    <text
                      x={viewBox.x + 10}
                      y={viewBox.y}
                      textAnchor="start"
                      fill={goal.color}
                      fontSize={CHART_CONFIG.marker.fontSize.goal}
                      dominantBaseline="middle"
                    >
                      {labelText}
                    </text>
                  </g>
                );
              }}
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
              name={`${pg.goal.label || "Goal"} Pacing: ${pg.goal.value} miles`}
              animationDuration={CHART_CONFIG.animation.duration}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PacingMetricsChart;
