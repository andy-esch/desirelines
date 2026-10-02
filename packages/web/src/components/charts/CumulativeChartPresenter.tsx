/**
 * CumulativeChartPresenter - Pure presentation component for cumulative distance charts.
 *
 * This is a "dumb" component that receives all data pre-computed and simply renders.
 * It has no state and no business logic - making it easy to test and reason about. Its hooks
 * read the theme: the date format and the average line's dash.
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
  type MouseHandlerDataParam,
} from "recharts";
import type {
  CumulativeChartDataPoint,
  CurrentChartValues,
  GoalLineData,
  GoalAchievement,
} from "../../types/chartData";
import { CHART_COLORS } from "../../constants/chartColors";
import type { PriorYearLine } from "../../hooks/useCumulativeChartData";
import { CHART_CONFIG, DANGER_ZONE_CONFIG } from "../../constants/chartConfig";
import { calculateCumulativeYAxisMax } from "../../utils/chartScaling";
import ChartLegend from "./ChartLegend";
import {
  ACTUAL_LINE,
  goalLine,
  legendItem,
  lineProps,
  priorYearLine,
  type ChartLine,
} from "./chartLines";
import ChartTooltip from "./ChartTooltip";
import YAxisMarker from "./YAxisMarker";
import { useThemeDateFormat } from "../theme/useThemeDateFormat";
import { useThemeTokenValue } from "../theme/useThemeTokenValue";

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
  /** Unit label for display (e.g., "mi", "km", "sessions") */
  unitLabel: string;
  /** Estimated year-end total, for the average line's name */
  estimatedYearEnd: number;
  /** Whether to use "sessions" terminology */
  isSessionsMode: boolean;

  // --- Feature Toggles ---
  /** Whether to show achievement markers and legend */
  showAchievements?: boolean | undefined;
  /** Whether line draw-in animation should play (false suppresses re-animation on prop changes) */
  isAnimationActive?: boolean | undefined;

  // --- Zoom ---
  /** Whether chart is currently zoomed */
  isZoomed?: boolean | undefined;
  /** Left edge of drag selection (timestamp), undefined when not dragging */
  selectionLeft?: number | undefined;
  /** Right edge of drag selection (timestamp), undefined when not dragging */
  selectionRight?: number | undefined;
  /** Mouse down handler for drag-to-zoom */
  onChartMouseDown?: ((state: MouseHandlerDataParam) => void) | undefined;
  /** Mouse move handler for drag-to-zoom */
  onChartMouseMove?: ((state: MouseHandlerDataParam) => void) | undefined;
  /** Mouse up handler for drag-to-zoom */
  onChartMouseUp?: (() => void) | undefined;

  // --- Prior Year Lines ---
  /** Prior year ghost line metadata (sorted most recent first) */
  priorYearLines?: PriorYearLine[] | undefined;

  // --- Danger Zone ---
  /** Configuration for the cumulative danger zone (zone of unachievability) */
  dangerZone?:
    | {
        show: boolean;
        threshold: number;
      }
    | undefined;
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
  const { formatDate } = useThemeDateFormat();
  if (achievements.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 50,
        right: 10,
        backgroundColor: "var(--color-surface-overlay)",
        borderRadius: "var(--tooltip-radius)",
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
              {/* achievement.date is a UTC-midnight chart date; render it in UTC per the
                  chart pipeline's date convention (see useCumulativeChartData header). */}
              {formatDate(achievement.date, {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
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
 *   unitLabel="mi"
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
  unitLabel,
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
  priorYearLines,
  dangerZone,
}: CumulativeChartPresenterProps) {
  const { formatAxisDate } = useThemeDateFormat();
  const [chartRef, averageDash] = useThemeTokenValue<HTMLDivElement>(
    CHART_CONFIG.averageDash.token,
    CHART_CONFIG.averageDash.fallback
  );
  // Each line described once; the <Line>s and the legend are both drawn from these.
  const goals = goalLines.map((gl, index) => goalLine(gl.goal, index));
  const average: ChartLine = {
    dataKey: "average",
    name: `Average · est ${Math.round(estimatedYearEnd).toLocaleString()}`,
    stroke: CHART_COLORS.AVERAGE_LINE,
    width: CHART_CONFIG.strokeWidth.goal,
    dash: averageDash,
  };
  const maxPace: ChartLine | undefined = dangerZone?.show
    ? {
        dataKey: "dangerBoundary",
        name: `Max at ${dangerZone.threshold.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unitLabel}/day`,
        stroke: DANGER_ZONE_CONFIG.line.stroke,
        width: DANGER_ZONE_CONFIG.line.strokeWidth,
        dash: DANGER_ZONE_CONFIG.line.strokeDasharray,
      }
    : undefined;
  const priorYears = (priorYearLines ?? []).map(priorYearLine);
  const legendItems = [
    ACTUAL_LINE,
    ...goals,
    average,
    ...(maxPace ? [maxPace] : []),
    ...priorYears,
  ].map(legendItem);
  // Recharts' handler props don't take `undefined`, so pass only the handlers given.
  const zoomHandlers = {
    ...(onChartMouseDown && { onMouseDown: onChartMouseDown }),
    ...(onChartMouseMove && { onMouseMove: onChartMouseMove }),
    ...(onChartMouseUp && { onMouseUp: onChartMouseUp }),
  };
  // The lines that draw in: the year's, the goals' and the average.
  const drawIn = {
    isAnimationActive,
    animationDuration: CHART_CONFIG.animation.duration,
    animationEasing: CHART_CONFIG.animation.easing,
  };

  return (
    <div ref={chartRef} style={{ position: "relative", userSelect: "none" }}>
      <ChartLegend items={legendItems} />
      <ResponsiveContainer width="100%" height={CHART_CONFIG.height}>
        <LineChart
          data={mergedData}
          margin={CHART_CONFIG.margin}
          accessibilityLayer
          {...zoomHandlers}
        >
          {/* Horizontal gridlines at Y-axis tick values */}
          <CartesianGrid stroke={CHART_CONFIG.grid.stroke} vertical={CHART_CONFIG.grid.vertical} />

          {/* X-Axis: Time */}
          <XAxis
            dataKey="date"
            type="number"
            domain={[startDate.getTime(), displayEndDate.getTime()]}
            allowDataOverflow
            tickFormatter={formatAxisDate}
            stroke={CHART_CONFIG.baseline.stroke}
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
            {...(isZoomed ? {} : { ticks: yAxisTicks })}
          />

          {/* Tooltip */}
          <Tooltip
            content={
              <ChartTooltip
                unit={unitLabel}
                decimals={1}
                compact
                goalLabels={goalLines.map((gl) => gl.goal.label || "Goal")}
              />
            }
          />

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

          {/* Prior year ghost lines (rendered first so they layer behind) */}
          {priorYears.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              {...lineProps(line)}
              dot={false}
              isAnimationActive={false}
            />
          ))}

          {/* Danger zone boundary — max achievable at sustainable pace */}
          {maxPace && (
            <Line type="monotone" {...lineProps(maxPace)} dot={false} isAnimationActive={false} />
          )}

          {/* Actual distance line */}
          <Line
            type="monotone"
            {...lineProps(ACTUAL_LINE)}
            style={CHART_CONFIG.actualLineStyle}
            dot={false}
            {...drawIn}
          />

          {/* Goal lines */}
          {goals.map((line, index) => (
            <Line
              key={goalLines[index]!.goal.id}
              type="monotone"
              {...lineProps(line)}
              dot={false}
              {...drawIn}
            />
          ))}

          {/* Average/projected line */}
          <Line type="monotone" {...lineProps(average)} dot={false} {...drawIn} />

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
