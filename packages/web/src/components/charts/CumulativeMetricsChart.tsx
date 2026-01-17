// Recharts implementation of CumulativeMetricsChart
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
  ReferenceDot,
} from "recharts";
import type { DistanceEntry } from "../../types/activity";
import { CHART_COLORS, GOAL_COLORS } from "../../constants/chartColors";
import { CHART_CONFIG } from "../../constants/chartConfig";
import LoadingChart from "./LoadingChart";
import ErrorChart from "./ErrorChart";
import EmptyState from "../EmptyState";
import { type Goals } from "../../utils/goalCalculations";
import ChartTooltip from "./ChartTooltip";
import { getDistanceLabel, type DistanceUnit, type MetricUnit } from "../../utils/units";
import { useCumulativeChartData } from "../../hooks/useCumulativeChartData";

interface CumulativeMetricsChartProps {
  year: number;
  goals: Goals;
  onGoalsChange?: (goals: Goals) => void;
  distanceData: DistanceEntry[];
  isLoading: boolean;
  error: Error | null;
  showFullYear?: boolean;
  onViewChange?: (showFullYear: boolean) => void;
  showAchievements?: boolean;
  onAchievementsChange?: (show: boolean) => void;
  hideHeader?: boolean;
  unit?: MetricUnit; // Unit for metric display (default: "miles", can be "sessions" for yoga)
  sport?: string; // Sport name for empty state message
  onRetry?: () => void; // Callback to retry loading data after error
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

const CumulativeMetricsChart = (props: CumulativeMetricsChartProps) => {
  const {
    year,
    goals,
    distanceData,
    isLoading,
    error,
    showFullYear = true,
    onViewChange,
    showAchievements = true,
    onAchievementsChange,
    hideHeader = false,
    unit = "miles", // Default to miles if not provided
    sport,
    onRetry,
  } = props;

  // Determine chart title based on metric type
  const chartTitle = unit === "sessions" ? "Cumulative Sessions" : "Cumulative Distance";

  const {
    totalDistanceTraveled,
    estimatedYearEnd,
    startDate,
    displayEndDate,
    goalLines,
    goalAchievements,
    mergedData,
    currentValues,
    yAxisTicks,
  } = useCumulativeChartData({
    year,
    goals,
    distanceData,
    showFullYear,
    sport,
  });

  // Early returns for loading/error states (must be after all hooks)
  if (isLoading) {
    return (
      <div>
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
      <div>
        {!hideHeader && (
          <h3 className="text-muted mb-3" style={{ fontSize: "1rem", fontWeight: "500" }}>
            {chartTitle}
          </h3>
        )}
        <ErrorChart error={error} onRetry={onRetry} />
      </div>
    );
  }

  // Empty state - no data available (not loading, no error)
  if (distanceData.length === 0) {
    return (
      <div>
        {!hideHeader && (
          <h3 className="text-muted mb-3" style={{ fontSize: "1rem", fontWeight: "500" }}>
            {chartTitle}
          </h3>
        )}
        <EmptyState sport={sport} year={year} unit={unit} message="No chart data available" />
      </div>
    );
  }

  return (
    <div>
      {!hideHeader && (
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div className="d-flex align-items-center gap-2">
            <h3 className="text-muted mb-0" style={{ fontSize: "1rem", fontWeight: "500" }}>
              {chartTitle}
            </h3>
            <span
              style={{
                cursor: "help",
                color: "#666",
                fontSize: "12px",
                borderRadius: "50%",
                width: "16px",
                height: "16px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #666",
              }}
              title="Y-axis labels show where each line currently sits — your actual progress vs. where goal trajectories are today. This shows the 'race' between your progress and your goals."
            >
              ?
            </span>
          </div>

          <div className="d-flex gap-2">
            {onAchievementsChange && goalAchievements.length > 0 && (
              <button
                type="button"
                className={`btn btn-sm ${showAchievements ? "btn-outline-warning" : "btn-outline-secondary"}`}
                onClick={() => onAchievementsChange(!showAchievements)}
                title={showAchievements ? "Hide achievement markers" : "Show achievement markers"}
              >
                {showAchievements ? "★" : "☆"} {goalAchievements.length}
              </button>
            )}

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
        </div>
      )}

      <div style={{ position: "relative" }}>
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
                // Use UTC formatting to avoid day shift when Recharts generates
                // ticks at UTC midnight boundaries (which would show as previous
                // day in local timezone like EST)
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
                value: unit === "sessions" ? "# Sessions" : getUnitLabel(unit),
                angle: -90,
                position: "insideLeft",
              }}
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
            <Tooltip content={<ChartTooltip unit={getUnitLabel(unit)} decimals={1} compact />} />

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

            {/* Goal achievement markers - colored stars */}
            {showAchievements &&
              goalAchievements.map((achievement, index) => {
                const markerConfig = CHART_CONFIG.achievementMarker;
                return (
                  <ReferenceDot
                    key={index}
                    x={achievement.date.getTime()}
                    y={achievement.actualValue}
                    r={0}
                    label={(props: { viewBox: { x: number; y: number } }) => {
                      const { viewBox } = props;
                      const cx = viewBox.x;
                      const cy = viewBox.y - markerConfig.yOffset;

                      return (
                        <g style={{ cursor: "pointer" }}>
                          {markerConfig.useSvgStar ? (
                            // SVG 5-point star path
                            <path
                              d={`M ${cx} ${cy - markerConfig.size}
                              L ${cx + markerConfig.size * 0.22} ${cy - markerConfig.size * 0.31}
                              L ${cx + markerConfig.size * 0.95} ${cy - markerConfig.size * 0.31}
                              L ${cx + markerConfig.size * 0.36} ${cy + markerConfig.size * 0.12}
                              L ${cx + markerConfig.size * 0.59} ${cy + markerConfig.size * 0.81}
                              L ${cx} ${cy + markerConfig.size * 0.38}
                              L ${cx - markerConfig.size * 0.59} ${cy + markerConfig.size * 0.81}
                              L ${cx - markerConfig.size * 0.36} ${cy + markerConfig.size * 0.12}
                              L ${cx - markerConfig.size * 0.95} ${cy - markerConfig.size * 0.31}
                              L ${cx - markerConfig.size * 0.22} ${cy - markerConfig.size * 0.31}
                              Z`}
                              fill={achievement.goalColor}
                              stroke={achievement.goalColor}
                              strokeWidth={1}
                            />
                          ) : (
                            // Unicode star character
                            <text
                              x={cx}
                              y={cy}
                              textAnchor="middle"
                              fontSize={markerConfig.unicodeFontSize}
                              dominantBaseline="middle"
                              fill={achievement.goalColor}
                            >
                              {markerConfig.unicodeChar}
                            </text>
                          )}
                          <title>{`${achievement.goalLabel} achieved! (${achievement.goalValue.toLocaleString()} ${getUnitLabel(unit)})`}</title>
                        </g>
                      );
                    }}
                  />
                );
              })}
          </LineChart>
        </ResponsiveContainer>

        {/* Achievement legend - lower right */}
        {showAchievements && goalAchievements.length > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: 50,
              right: 10,
              backgroundColor: "rgba(0, 0, 0, 0.7)",
              borderRadius: 4,
              padding: "6px 10px",
              fontSize: 11,
            }}
          >
            <div style={{ color: "#888", fontSize: 10, marginBottom: 4 }}>Goals Achieved</div>
            {goalAchievements.map((achievement, index) => (
              <div key={index} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: achievement.goalColor }}>★</span>
                <span style={{ color: "#ccc" }}>
                  {achievement.goalLabel}{" "}
                  <span style={{ color: "#888" }}>
                    {achievement.date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(CumulativeMetricsChart);
