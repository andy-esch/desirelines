// Recharts implementation of PacingChart
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
} from "recharts";
import type { DistanceEntry } from "../../types/activity";
import { CHART_COLORS, GOAL_COLORS } from "../../constants/chartColors";
import { CHART_CONFIG } from "../../constants/chartConfig";
import LoadingChart from "./LoadingChart";
import ErrorChart from "./ErrorChart";
import {
  calculateActualPacing,
  calculateDynamicPacingGoal,
  type Goals,
} from "../../utils/goalCalculations";

interface PacingChartProps {
  year: number;
  goals: Goals;
  onGoalsChange?: (goals: Goals) => void;
  distanceData: DistanceEntry[];
  isLoading: boolean;
  error: Error | null;
}

const PacingChartRecharts = (props: PacingChartProps) => {
  const { year, goals, distanceData, isLoading, error } = props;

  // Derive values from distanceData
  const latestDate = useMemo(() => {
    if (distanceData.length === 0) return new Date();
    const lastEntry = distanceData[distanceData.length - 1];
    return new Date(lastEntry?.x || new Date());
  }, [distanceData]);

  const actualPacing = useMemo(() => {
    if (distanceData.length === 0) return [];
    return calculateActualPacing(distanceData, latestDate);
  }, [distanceData, latestDate]);

  // Calculate dynamic pacing goals (must be before early returns per React hooks rules)
  const pacingGoals = useMemo(
    () =>
      goals.map((goal) => ({
        goal,
        pacing: calculateDynamicPacingGoal(distanceData, goal.value, year, latestDate),
      })),
    [goals, distanceData, year, latestDate]
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

  // Get current values (at the latest date)
  const latestData = mergedData[mergedData.length - 1];
  const currentValues = {
    actual: (latestData?.actual as number) || 0,
    goals: pacingGoals.map((pg, index) => ({
      label: pg.goal.label,
      value: (latestData?.[`goal${index}`] as number) || 0,
      color: GOAL_COLORS[index % GOAL_COLORS.length],
    })),
  };

  // Early returns for loading/error states (must be after all hooks)
  if (isLoading) {
    return (
      <div>
        <h2 style={{ textAlign: "center" }}>Pacings</h2>
        <LoadingChart />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2 style={{ textAlign: "center" }}>Pacings</h2>
        <ErrorChart error={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ textAlign: "center" }}>Pacings</h2>
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
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={(timestamp) => {
              const date = new Date(timestamp);
              return `${date.getMonth() + 1}/${date.getDate()}`;
            }}
            stroke={CHART_CONFIG.axis.stroke}
          />
          <YAxis
            label={{ value: "Miles/Day", angle: -90, position: "insideLeft" }}
            domain={[0, "auto"]}
            stroke={CHART_CONFIG.axis.stroke}
            tickFormatter={(value: number) => value.toFixed(1)}
          />
          <Tooltip
            labelFormatter={(timestamp) => {
              const date = new Date(timestamp as number);
              return date.toLocaleDateString();
            }}
            formatter={(value: number) => value.toFixed(2)}
            contentStyle={CHART_CONFIG.tooltip.contentStyle}
          />

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
                    x={viewBox.x - 10}
                    y={viewBox.y}
                    textAnchor="end"
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
                return (
                  <g>
                    <circle
                      cx={viewBox.x}
                      cy={viewBox.y}
                      r={CHART_CONFIG.marker.radius}
                      fill={goal.color}
                    />
                    <text
                      x={viewBox.x - 10}
                      y={viewBox.y}
                      textAnchor="end"
                      fill={goal.color}
                      fontSize={CHART_CONFIG.marker.fontSize.goal}
                      dominantBaseline="middle"
                    >
                      {goal.label}
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

export default PacingChartRecharts;
