/**
 * CumulativeChartPresenter - Pure presentation component for cumulative distance charts.
 *
 * This is a "dumb" component that receives all data pre-computed and simply renders.
 * It has no hooks, no state, and no business logic - making it easy to test and reason about.
 *
 * The parent container (CumulativeMetricsChart) handles:
 * - Data fetching and transformation via useCumulativeChartData hook
 * - Loading/error/empty states via ChartContainer
 * - User interaction callbacks
 *
 * This presenter handles:
 * - Pure rendering of the chart visualization
 * - SVG elements for lines, markers, and achievements
 */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  ReferenceArea,
} from "recharts";
import type {
  CumulativeChartDataPoint,
  CurrentChartValues,
  GoalLineData,
  GoalAchievement,
} from "../../types/chartData";
import { CHART_COLORS, GOAL_COLORS } from "../../constants/chartColors";
import { CHART_CONFIG, calculateCumulativeYAxisMax } from "../../constants/chartConfig";
import ChartTooltip from "./ChartTooltip";
import YAxisMarker from "./YAxisMarker";
import { formatChartAxisDate } from "../../utils/dateUtils";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the CumulativeChartPresenter component.
 *
 * All props are pre-computed by the parent container - this component
 * performs no calculations or data transformations.
 */
export interface CumulativeChartPresenterProps {
  // --- Chart Data ---
  /** Merged data points for all lines (actual, goals, average) */
  mergedData: CumulativeChartDataPoint[];
  /** Goal line configurations with metadata */
  goalLines: GoalLineData[];
  /** Goal achievement markers (where actual crossed goal lines) */
  goalAchievements: GoalAchievement[];
  /** Current values for Y-axis markers */
  currentValues: CurrentChartValues;

  // --- Domain Configuration ---
  /** Start of X-axis domain (timestamp) */
  startDate: Date;
  /** End of X-axis domain (timestamp) */
  displayEndDate: Date;
  /** Pre-computed Y-axis tick values */
  yAxisTicks: number[];

  // --- Display Information ---
  /** Year being displayed (for line names in legend) */
  year: number;
  /** Unit label for display (e.g., "mi", "km", "sessions") */
  unitLabel: string;
  /** Total distance for actual line name */
  totalDistanceTraveled: number;
  /** Estimated year-end total for average line name */
  estimatedYearEnd: number;
  /** Whether to use "sessions" terminology */
  isSessionsMode: boolean;

  // --- Feature Toggles ---
  /** Whether to show achievement markers and legend */
  showAchievements?: boolean;
  /** Whether line draw-in animation should play (false suppresses re-animation on prop changes) */
  isAnimationActive?: boolean;

  // --- Zoom ---
  /** Whether chart is currently zoomed */
  isZoomed?: boolean;
  /** Left edge of drag selection (timestamp), undefined when not dragging */
  selectionLeft?: number;
  /** Right edge of drag selection (timestamp), undefined when not dragging */
  selectionRight?: number;
  /** Mouse down handler for drag-to-zoom */
  onChartMouseDown?: (e: { activeLabel?: string | number }) => void;
  /** Mouse move handler for drag-to-zoom */
  onChartMouseMove?: (e: { activeLabel?: string | number }) => void;
  /** Mouse up handler for drag-to-zoom */
  onChartMouseUp?: () => void;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Renders a star marker for goal achievements.
 * Extracted to keep the main component clean.
 */
function AchievementStar({
  cx,
  cy,
  color,
  tooltip,
}: {
  cx: number;
  cy: number;
  color: string;
  tooltip: string;
}) {
  const config = CHART_CONFIG.achievementMarker;
  const adjustedCy = cy - config.yOffset;

  return (
    <g style={{ cursor: "pointer" }}>
      {config.svgStar ? (
        <path
          d={`M ${cx} ${adjustedCy - config.size}
            L ${cx + config.size * 0.22} ${adjustedCy - config.size * 0.31}
            L ${cx + config.size * 0.95} ${adjustedCy - config.size * 0.31}
            L ${cx + config.size * 0.36} ${adjustedCy + config.size * 0.12}
            L ${cx + config.size * 0.59} ${adjustedCy + config.size * 0.81}
            L ${cx} ${adjustedCy + config.size * 0.38}
            L ${cx - config.size * 0.59} ${adjustedCy + config.size * 0.81}
            L ${cx - config.size * 0.36} ${adjustedCy + config.size * 0.12}
            L ${cx - config.size * 0.95} ${adjustedCy - config.size * 0.31}
            L ${cx - config.size * 0.22} ${adjustedCy - config.size * 0.31}
            Z`}
          fill={color}
          stroke={color}
          strokeWidth={1}
        />
      ) : (
        <text
          x={cx}
          y={adjustedCy}
          textAnchor="middle"
          fontSize={config.unicodeFontSize}
          dominantBaseline="middle"
          fill={color}
        >
          {config.unicodeChar}
        </text>
      )}
      <title>{tooltip}</title>
    </g>
  );
}

/**
 * Renders the achievement legend overlay in the bottom-right corner.
 */
function AchievementLegend({ achievements }: { achievements: GoalAchievement[] }) {
  if (achievements.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 50,
        right: 10,
        backgroundColor: "var(--color-surface-overlay)",
        borderRadius: 4,
        padding: "6px 10px",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--color-chart-tooltip-label)", fontSize: 10, marginBottom: 4 }}>
        Goals Achieved
      </div>
      {achievements.map((achievement, index) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: achievement.goalColor }}>★</span>
          <span style={{ color: "var(--color-chart-tooltip-muted)" }}>
            {achievement.goalLabel}{" "}
            <span style={{ color: "var(--color-chart-tooltip-label)" }}>
              {achievement.date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Pure presentation component for cumulative distance/sessions charts.
 *
 * @example
 * ```tsx
 * <CumulativeChartPresenter
 *   mergedData={chartData.mergedData}
 *   goalLines={chartData.goalLines}
 *   goalAchievements={chartData.goalAchievements}
 *   currentValues={chartData.currentValues}
 *   startDate={chartData.startDate}
 *   displayEndDate={chartData.displayEndDate}
 *   yAxisTicks={chartData.yAxisTicks}
 *   year={2024}
 *   unitLabel="mi"
 *   totalDistanceTraveled={1500}
 *   estimatedYearEnd={3000}
 *   isSessionsMode={false}
 *   showAchievements={true}
 * />
 * ```
 */
export function CumulativeChartPresenter({
  mergedData,
  goalLines,
  goalAchievements,
  currentValues,
  startDate,
  displayEndDate,
  yAxisTicks,
  year,
  unitLabel,
  totalDistanceTraveled,
  estimatedYearEnd,
  isSessionsMode,
  showAchievements = true,
  isAnimationActive = true,
  isZoomed = false,
  selectionLeft,
  selectionRight,
  onChartMouseDown,
  onChartMouseMove,
  onChartMouseUp,
}: CumulativeChartPresenterProps) {
  return (
    <div style={{ position: "relative", userSelect: "none" }}>
      <ResponsiveContainer width="100%" height={CHART_CONFIG.height}>
        <LineChart
          data={mergedData}
          margin={CHART_CONFIG.margin}
          accessibilityLayer
          onMouseDown={onChartMouseDown as never}
          onMouseMove={onChartMouseMove as never}
          onMouseUp={onChartMouseUp}
        >
          {/* Horizontal gridlines at Y-axis tick values */}
          <CartesianGrid stroke={CHART_CONFIG.grid.stroke} vertical={CHART_CONFIG.grid.vertical} />

          {/* X-Axis: Time */}
          <XAxis
            dataKey="date"
            type="number"
            domain={[startDate.getTime(), displayEndDate.getTime()]}
            allowDataOverflow
            tickFormatter={formatChartAxisDate}
            stroke={CHART_CONFIG.axis.stroke}
            tick={CHART_CONFIG.tick}
            interval="preserveStartEnd"
          />

          {/* Y-Axis: Distance/Sessions */}
          <YAxis
            label={{
              value: isSessionsMode ? "# Sessions" : unitLabel,
              angle: -90,
              position: "insideLeft",
              fill: CHART_CONFIG.tick.fill,
              style: { fontFamily: CHART_CONFIG.tick.fontFamily, fontSize: 12 },
            }}
            stroke={CHART_CONFIG.axis.stroke}
            tick={CHART_CONFIG.tick}
            allowDataOverflow
            domain={isZoomed ? [0, "auto"] : [0, calculateCumulativeYAxisMax]}
            ticks={isZoomed ? undefined : yAxisTicks}
          />

          {/* Tooltip */}
          <Tooltip content={<ChartTooltip unit={unitLabel} decimals={1} compact />} />

          {/* Y-axis markers showing current values */}
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

          {/* Actual distance line */}
          <Line
            type="monotone"
            dataKey="actual"
            stroke={CHART_COLORS.ACTUAL_DATA_LINE}
            strokeWidth={CHART_CONFIG.strokeWidth.actual}
            dot={false}
            name={`${year} Data: ${totalDistanceTraveled.toFixed(1)} ${unitLabel}`}
            isAnimationActive={isAnimationActive}
            animationDuration={CHART_CONFIG.animation.duration}
            animationEasing={CHART_CONFIG.animation.easing}
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
              name={`${gl.goal.label || "Goal"}: ${gl.goal.value} ${unitLabel}`}
              isAnimationActive={isAnimationActive}
              animationDuration={CHART_CONFIG.animation.duration}
              animationEasing={CHART_CONFIG.animation.easing}
            />
          ))}

          {/* Average/projected line */}
          <Line
            type="monotone"
            dataKey="average"
            stroke={CHART_COLORS.AVERAGE_LINE}
            strokeWidth={CHART_CONFIG.strokeWidth.goal}
            strokeDasharray="5 5"
            dot={false}
            name={`Current Average (Est: ${estimatedYearEnd.toFixed(0)} ${unitLabel})`}
            isAnimationActive={isAnimationActive}
            animationDuration={CHART_CONFIG.animation.duration}
            animationEasing={CHART_CONFIG.animation.easing}
          />

          {/* Achievement markers */}
          {showAchievements &&
            goalAchievements.map((achievement, index) => (
              <ReferenceDot
                key={index}
                x={achievement.date.getTime()}
                y={achievement.actualValue}
                r={0}
                label={(props: { viewBox: { x: number; y: number } }) => (
                  <AchievementStar
                    cx={props.viewBox.x}
                    cy={props.viewBox.y}
                    color={achievement.goalColor}
                    tooltip={`${achievement.goalLabel} achieved! (${achievement.goalValue.toLocaleString()} ${unitLabel})`}
                  />
                )}
              />
            ))}
          {/* Drag selection overlay */}
          {selectionLeft != null && selectionRight != null && (
            <ReferenceArea
              x1={selectionLeft}
              x2={selectionRight}
              strokeOpacity={0.3}
              fill={CHART_CONFIG.selection.fill}
              fillOpacity={CHART_CONFIG.selection.fillOpacity}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Achievement legend overlay */}
      {showAchievements && <AchievementLegend achievements={goalAchievements} />}
    </div>
  );
}

export default CumulativeChartPresenter;
