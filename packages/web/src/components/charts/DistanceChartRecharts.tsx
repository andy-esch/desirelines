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
import ChartTooltip from "./ChartTooltip";

interface DistanceChartProps {
  year: number;
  goals: Goals;
  onGoalsChange?: (goals: Goals) => void;
  distanceData: DistanceEntry[];
  isLoading: boolean;
  error: Error | null;
  showFullYear?: boolean;
  onViewChange?: (showFullYear: boolean) => void;
  hideHeader?: boolean;
}

// Removed CustomTooltip - now using shared ChartTooltip component

const DistanceChartRecharts = (props: DistanceChartProps) => {
  const {
    year,
    goals,
    distanceData,
    isLoading,
    error,
    showFullYear = true,
    onViewChange,
    hideHeader = false,
  } = props;

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

  // Calculate year boundaries
  const startDate = useMemo(() => new Date(year, 0, 1), [year]);
  const endDate = useMemo(() => new Date(year, 11, 31), [year]);

  // Use either full year or current date based on toggle
  const displayEndDate = showFullYear ? endDate : latestDate;

  // Calculate goal lines (must be before early returns per React hooks rules)
  const goalLines = useMemo(
    () =>
      goals.map((goal) => ({
        goal,
        line: calculateDesireLine(goal.value, year, displayEndDate),
      })),
    [goals, year, displayEndDate]
  );

  // Project average line
  const currentAverageLine = useMemo(
    () => calculateCurrentAverageLine(distanceData, year, displayEndDate),
    [distanceData, year, displayEndDate]
  );

  // Detect goal achievements (when actual crosses goal line)
  const goalAchievements = useMemo(() => {
    const achievements: Array<{
      date: Date;
      goalLabel: string;
      goalValue: number;
      actualValue: number;
      goalColor: string;
      goalIndex: number;
    }> = [];

    goalLines.forEach((gl, index) => {
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
            goalColor: GOAL_COLORS[index % GOAL_COLORS.length],
            goalIndex: index,
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
    actual: totalDistanceTraveled, // Use actual distance traveled, not merged data
    goals: goalLines.map((gl, index) => {
      // Get goal value at the latest actual data point
      const goalValue = currentActualData?.[`goal${index}`] as number;
      return {
        label: gl.goal.label,
        value: goalValue || gl.goal.value,
        color: GOAL_COLORS[index % GOAL_COLORS.length],
      };
    }),
    average: (currentActualData?.average as number) || 0,
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
        {!hideHeader && (
          <h3 className="text-muted mb-3" style={{ fontSize: "1rem", fontWeight: "500" }}>
            Cumulative Distance
          </h3>
        )}
        <LoadingChart />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {!hideHeader && (
          <h3 className="text-muted mb-3" style={{ fontSize: "1rem", fontWeight: "500" }}>
            Cumulative Distance
          </h3>
        )}
        <ErrorChart error={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      {!hideHeader && (
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h3 className="text-muted mb-0" style={{ fontSize: "1rem", fontWeight: "500" }}>
            Cumulative Distance
          </h3>

          {onViewChange && (
            <div className="btn-group btn-group-sm" role="group">
              <input
                type="radio"
                className="btn-check"
                name="chartView"
                id="viewCurrent"
                autoComplete="off"
                checked={!showFullYear}
                onChange={() => onViewChange(false)}
              />
              <label className="btn btn-outline-secondary" htmlFor="viewCurrent">
                Current
              </label>

              <input
                type="radio"
                className="btn-check"
                name="chartView"
                id="viewFullYear"
                autoComplete="off"
                checked={showFullYear}
                onChange={() => onViewChange(true)}
              />
              <label className="btn btn-outline-secondary" htmlFor="viewFullYear">
                Full Year
              </label>
            </div>
          )}
        </div>
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
          <Tooltip content={<ChartTooltip unit="mi" decimals={1} />} />

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
                    {/* Colored circle background matching the goal */}
                    <circle
                      cx={viewBox.x}
                      cy={viewBox.y - 15}
                      r={14}
                      fill={achievement.goalColor}
                      opacity={0.3}
                    />
                    <circle
                      cx={viewBox.x}
                      cy={viewBox.y - 15}
                      r={12}
                      fill={achievement.goalColor}
                      opacity={0.5}
                    />
                    {/* Emoji on top */}
                    <text
                      x={viewBox.x}
                      y={viewBox.y - 15}
                      textAnchor="middle"
                      fontSize={16}
                      dominantBaseline="middle"
                      style={{ cursor: "pointer" }}
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
