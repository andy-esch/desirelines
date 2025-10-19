// Recharts implementation of DistanceChart
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
  ReferenceDot,
} from "recharts";
import type { DistanceEntry } from "../../types/activity";
import { CHART_COLORS, GOAL_COLORS } from "../../constants/chartColors";
import { CHART_CONFIG } from "../../constants/chartConfig";
import LoadingChart from "./LoadingChart";
import ErrorChart from "./ErrorChart";
import {
  calculateDesireLine,
  calculateCurrentAverageLine,
  estimateYearEndDistance,
  type Goals,
} from "../../utils/goalCalculations";

interface DistanceChartProps {
  year: number;
  goals: Goals;
  onGoalsChange?: (goals: Goals) => void;
  distanceData: DistanceEntry[];
  isLoading: boolean;
  error: Error | null;
}

const DistanceChartRecharts = (props: DistanceChartProps) => {
  const { year, goals, distanceData, isLoading, error } = props;

  // Derive values from distanceData
  const latestDate = useMemo(() => {
    if (distanceData.length === 0) return new Date();
    const lastEntry = distanceData[distanceData.length - 1];
    return new Date(lastEntry?.x || new Date());
  }, [distanceData]);

  const totalDistanceTraveled = useMemo(() => {
    if (distanceData.length === 0) return 0;
    const lastEntry = distanceData[distanceData.length - 1];
    return lastEntry?.y || 0;
  }, [distanceData]);

  const estimatedYearEnd = useMemo(() => {
    if (distanceData.length === 0) return 0;
    return estimateYearEndDistance(distanceData, year);
  }, [distanceData, year]);

  // Calculate goal lines (must be before early returns per React hooks rules)
  const goalLines = useMemo(
    () =>
      goals.map((goal) => ({
        goal,
        line: calculateDesireLine(goal.value, year, latestDate),
      })),
    [goals, year, latestDate]
  );

  const currentAverageLine = useMemo(
    () => calculateCurrentAverageLine(distanceData, year, latestDate),
    [distanceData, year, latestDate]
  );

  // Detect goal achievements (when actual crosses goal line)
  const goalAchievements = useMemo(() => {
    const achievements: Array<{
      date: Date;
      goalLabel: string;
      goalValue: number;
      actualValue: number;
    }> = [];

    goalLines.forEach((gl) => {
      // Find first point where actual distance exceeds goal
      for (let i = 1; i < distanceData.length; i++) {
        const prevActual = distanceData[i - 1].y;
        const currActual = distanceData[i].y;
        const goalValue = gl.goal.value;

        // Check if we crossed the goal line (from below to above)
        if (prevActual < goalValue && currActual >= goalValue) {
          achievements.push({
            date: new Date(distanceData[i].x),
            goalLabel: gl.goal.label || "Goal",
            goalValue: goalValue,
            actualValue: currActual,
          });
          break; // Only track first achievement of each goal
        }
      }
    });

    return achievements;
  }, [distanceData, goalLines]);

  // Merge all data into a single array for Recharts
  // Recharts expects data like: [{ date: ..., actual: ..., goal1: ..., goal2: ..., average: ... }]
  const mergedData = useMemo(() => {
    const dataMap = new Map<number, Record<string, number | Date>>();

    // Add actual distance data
    distanceData.forEach((point) => {
      dataMap.set(new Date(point.x).getTime(), {
        date: new Date(point.x),
        actual: point.y,
      });
    });

    // Add goal lines
    goalLines.forEach((gl, index) => {
      gl.line.forEach((point) => {
        const timestamp = new Date(point.x).getTime();
        const existing = dataMap.get(timestamp) || { date: new Date(point.x) };
        dataMap.set(timestamp, {
          ...existing,
          [`goal${index}`]: point.y,
        });
      });
    });

    // Add average line
    currentAverageLine.forEach((point) => {
      const timestamp = new Date(point.x).getTime();
      const existing = dataMap.get(timestamp) || { date: new Date(point.x) };
      dataMap.set(timestamp, {
        ...existing,
        average: point.y,
      });
    });

    // Convert map to sorted array
    return Array.from(dataMap.values()).sort(
      (a, b) => (a.date as Date).getTime() - (b.date as Date).getTime()
    );
  }, [distanceData, goalLines, currentAverageLine]);

  // Get current values (at the latest date)
  const latestData = mergedData[mergedData.length - 1];
  const currentValues = {
    actual: (latestData?.actual as number) || 0,
    goals: goalLines.map((gl, index) => ({
      label: gl.goal.label,
      value: (latestData?.[`goal${index}`] as number) || gl.goal.value,
      color: GOAL_COLORS[index % GOAL_COLORS.length],
    })),
    average: (latestData?.average as number) || 0,
  };

  // Calculate Y-axis ticks based on data range
  const yAxisTicks = useMemo(() => {
    const maxValue = Math.max(
      ...mergedData.flatMap(
        (d) =>
          [
            d.actual,
            ...Object.keys(d)
              .filter((k) => k.startsWith("goal"))
              .map((k) => d[k] as number),
            d.average,
          ].filter((v) => v !== undefined) as number[]
      )
    );

    let interval = 250;
    if (maxValue < 500) interval = 100;
    else if (maxValue < 2000) interval = 250;
    else if (maxValue < 5000) interval = 500;
    else interval = 1000;

    const ticks = [];
    for (let i = 0; i <= maxValue + interval; i += interval) {
      ticks.push(i);
    }
    return ticks;
  }, [mergedData]);

  // Early returns for loading/error states (must be after all hooks)
  if (isLoading) {
    return (
      <div>
        <h2 style={{ textAlign: "center" }}>Distances</h2>
        <LoadingChart />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2 style={{ textAlign: "center" }}>Distances</h2>
        <ErrorChart error={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ textAlign: "center" }}>Distances</h2>
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
              const month = date.toLocaleDateString('en-US', { month: 'short' });
              const day = date.getDate();
              return `${month} ${day}`;
            }}
            stroke={CHART_CONFIG.axis.stroke}
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            label={{ value: "Miles", angle: -90, position: "insideLeft" }}
            stroke={CHART_CONFIG.axis.stroke}
            domain={[
              0,
              (dataMax: number) => {
                // Round up to next clean interval
                if (dataMax < 500) return Math.ceil(dataMax / 100) * 100;
                if (dataMax < 2000) return Math.ceil(dataMax / 250) * 250;
                if (dataMax < 5000) return Math.ceil(dataMax / 500) * 500;
                return Math.ceil(dataMax / 1000) * 1000;
              },
            ]}
            ticks={yAxisTicks}
          />
          <Tooltip
            labelFormatter={(timestamp) => {
              const date = new Date(timestamp as number);
              return date.toLocaleDateString();
            }}
            formatter={(value: number) => value.toFixed(1)}
            contentStyle={CHART_CONFIG.tooltip.contentStyle}
            labelStyle={CHART_CONFIG.tooltip.labelStyle}
            itemStyle={CHART_CONFIG.tooltip.itemStyle}
          />

          {/* Y-axis markers for current values */}
          <ReferenceLine
            y={currentValues.actual}
            stroke="transparent"
            label={(props) => {
              const { viewBox } = props;
              const label = "Actual";
              const padding = 4;
              const textWidth = label.length * 6; // Approximate width
              return (
                <g>
                  <rect
                    x={viewBox.x - textWidth - 10 - padding * 2}
                    y={viewBox.y - 10}
                    width={textWidth + padding * 2}
                    height={20}
                    fill="rgba(0, 0, 0, 0.7)"
                    rx={3}
                  />
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
                const padding = 4;
                const labelText = goal.label || "Goal";
                const textWidth = labelText.length * 6; // Approximate width
                return (
                  <g>
                    <rect
                      x={viewBox.x - textWidth - 10 - padding * 2}
                      y={viewBox.y - 9}
                      width={textWidth + padding * 2}
                      height={18}
                      fill="rgba(0, 0, 0, 0.7)"
                      rx={3}
                    />
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
                      {labelText}
                    </text>
                  </g>
                );
              }}
            />
          ))}
          <ReferenceLine
            y={currentValues.average}
            stroke="transparent"
            label={(props) => {
              const { viewBox } = props;
              const label = "Average";
              const padding = 4;
              const textWidth = label.length * 6; // Approximate width
              return (
                <g>
                  <rect
                    x={viewBox.x - textWidth - 10 - padding * 2}
                    y={viewBox.y - 9}
                    width={textWidth + padding * 2}
                    height={18}
                    fill="rgba(0, 0, 0, 0.7)"
                    rx={3}
                  />
                  <circle
                    cx={viewBox.x}
                    cy={viewBox.y}
                    r={CHART_CONFIG.marker.radius}
                    fill={CHART_COLORS.AVERAGE_LINE}
                  />
                  <text
                    x={viewBox.x - 10}
                    y={viewBox.y}
                    textAnchor="end"
                    fill={CHART_COLORS.AVERAGE_LINE}
                    fontSize={CHART_CONFIG.marker.fontSize.goal}
                    dominantBaseline="middle"
                  >
                    Average
                  </text>
                </g>
              );
            }}
          />

          {/* Actual distance */}
          <Line
            type="monotone"
            dataKey="actual"
            stroke={CHART_COLORS.ACTUAL_DATA_LINE}
            strokeWidth={CHART_CONFIG.strokeWidth.actual}
            dot={false}
            name={`${year} Data: ${totalDistanceTraveled.toFixed(1)} miles`}
            animationDuration={CHART_CONFIG.animation.duration}
          />

          {/* Goal lines */}
          {goalLines.map((gl, index) => (
            <Line
              key={gl.goal.id}
              type="monotone"
              dataKey={`goal${index}`}
              stroke={GOAL_COLORS[index % GOAL_COLORS.length]}
              strokeWidth={CHART_CONFIG.strokeWidth.goal}
              dot={false}
              name={`${gl.goal.label || "Goal"}: ${gl.goal.value} miles`}
              animationDuration={CHART_CONFIG.animation.duration}
            />
          ))}

          {/* Average line */}
          <Line
            type="monotone"
            dataKey="average"
            stroke={CHART_COLORS.AVERAGE_LINE}
            strokeWidth={CHART_CONFIG.strokeWidth.goal}
            strokeDasharray="5 5"
            dot={false}
            name={`Current Average (Est: ${estimatedYearEnd.toFixed(0)} miles)`}
            animationDuration={CHART_CONFIG.animation.duration}
          />

          {/* Goal achievement markers */}
          {goalAchievements.map((achievement, index) => (
            <ReferenceDot
              key={index}
              x={achievement.date.getTime()}
              y={achievement.actualValue}
              r={0}
              label={(props: any) => {
                const { viewBox } = props;
                return (
                  <g>
                    <text
                      x={viewBox.x}
                      y={viewBox.y - 10}
                      textAnchor="middle"
                      fontSize={20}
                      style={{ cursor: 'pointer' }}
                    >
                      🎉
                    </text>
                    <title>{`${achievement.goalLabel} achieved! (${achievement.goalValue} miles)`}</title>
                  </g>
                );
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DistanceChartRecharts;
