/**
 * PacingChartPresenter - Pure presentation component for daily pacing charts.
 *
 * This is a "dumb" component that receives all data pre-computed and simply renders.
 * It has no state and no business logic - making it easy to test and reason about. Its hooks
 * read the theme's date format and give the danger zone's hatch an id of its own.
 *
 * The parent container (PacingMetricsChart) handles:
 * - Data fetching and transformation via usePacingChartData hook
 * - Loading/error/empty states via ChartContainer
 *
 * This presenter handles:
 * - Pure rendering of the chart visualization
 * - Danger zone display (zone of unachievability)
 */
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
import type {
  PacingChartDataPoint,
  CurrentChartValues,
  PacingGoalData,
} from "../../types/chartData";
import { CHART_COLORS } from "../../constants/chartColors";
import { CHART_CONFIG, DANGER_ZONE_CONFIG } from "../../constants/chartConfig";
import ChartLegend, { type LegendItem } from "./ChartLegend";
import { ACTUAL_LINE, goalLine, legendItem, lineProps } from "./chartLines";
import ChartTooltip from "./ChartTooltip";
import { DangerHatch, useDangerHatchId } from "./DangerHatch";
import YAxisMarker from "./YAxisMarker";
import { useThemeDateFormat } from "../theme/useThemeDateFormat";

// ============================================================================
// Types
// ============================================================================

/** Configuration for the danger zone (zone of unachievability) */
export interface DangerZoneConfig {
  /** Whether to show the danger zone */
  show: boolean;
  /** Y-value threshold where danger zone starts */
  threshold: number;
  /** Maximum Y value (top of danger zone) */
  yMax: number;
}

/**
 * Props for the PacingChartPresenter component.
 *
 * All props are pre-computed by the parent container - this component
 * performs no calculations or data transformations.
 */
export interface PacingChartPresenterProps {
  // --- Chart Data ---
  /** Merged data points for all lines (actual pacing, goal pacing lines) */
  mergedData: PacingChartDataPoint[];
  /** Pacing goal line configurations with metadata */
  pacingGoals: PacingGoalData[];
  /** Current values for Y-axis markers */
  currentValues: CurrentChartValues;

  // --- Domain Configuration ---
  /** Start of X-axis domain */
  startDate: Date;
  /** End of X-axis domain */
  displayEndDate: Date;
  /** Maximum Y value for domain */
  naturalYMax: number;

  // --- Display Information ---
  /** Unit label for display (e.g., "mi", "km") */
  unitLabel: string;
  /** Whether to use "sessions" terminology */
  isSessionsMode: boolean;

  // --- Feature Toggles ---
  /** Whether line draw-in animation should play (false suppresses re-animation on prop changes) */
  isAnimationActive?: boolean;

  // --- Danger Zone ---
  /** Configuration for the danger zone display */
  dangerZone: DangerZoneConfig;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Renders the danger zone (zone of unachievability) visual elements: a hatched area and a
 * labeled threshold line. The stripes carry their own transparency, so the area paints
 * them at full opacity.
 */
function DangerZoneOverlay({
  threshold,
  yMax,
  unitLabel,
}: {
  threshold: number;
  yMax: number;
  unitLabel: string;
}) {
  const { area, line, label } = DANGER_ZONE_CONFIG;
  const hatchId = useDangerHatchId();

  return (
    <>
      <defs>
        <DangerHatch id={hatchId} />
      </defs>

      {/* Shaded danger zone area */}
      <ReferenceArea
        y1={threshold}
        y2={yMax}
        fill={`url(#${hatchId})`}
        fillOpacity={1}
        stroke={area.stroke}
        strokeDasharray={area.strokeDasharray}
      />

      {/* Threshold line with label */}
      <ReferenceLine
        y={threshold}
        stroke={line.stroke}
        strokeWidth={line.strokeWidth}
        strokeDasharray={line.strokeDasharray}
        label={{
          value: `Zone of Unachievability (${threshold.toFixed(1)} ${unitLabel}/day)`,
          position: label.position,
          fill: label.fill,
          fontSize: label.fontSize,
          fontWeight: label.fontWeight,
          fontStyle: label.fontStyle,
          offset: label.offset,
        }}
      />
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Pure presentation component for daily pacing charts.
 *
 * Shows the required daily pace to achieve goals, with a "danger zone"
 * indicating when the required pace becomes unrealistic.
 *
 * @example
 * ```tsx
 * <PacingChartPresenter
 *   mergedData={chartData.mergedData}
 *   pacingGoals={chartData.pacingGoals}
 *   currentValues={chartData.currentValues}
 *   startDate={chartData.startDate}
 *   displayEndDate={chartData.displayEndDate}
 *   naturalYMax={chartData.naturalYMax}
 *   unitLabel="mi"
 *   isSessionsMode={false}
 *   dangerZone={{
 *     show: chartData.shouldShowDangerZone,
 *     threshold: chartData.dangerThreshold,
 *     yMax: chartData.naturalYMax,
 *   }}
 * />
 * ```
 */
function PacingChartPresenter({
  mergedData,
  pacingGoals,
  currentValues,
  startDate,
  displayEndDate,
  naturalYMax,
  unitLabel,
  isSessionsMode,
  isAnimationActive = true,
  dangerZone,
}: PacingChartPresenterProps) {
  const { formatAxisDate } = useThemeDateFormat();
  const yAxisLabel = isSessionsMode ? "# Sessions / Day" : `${unitLabel} / Day`;
  const tooltipUnit = `${unitLabel}/day`;
  // Each line described once; the <Line>s and the legend are both drawn from these.
  const goals = pacingGoals.map((pg, index) => goalLine(pg.goal, index));
  const legendItems: LegendItem[] = [
    ...[ACTUAL_LINE, ...goals].map(legendItem),
    ...(dangerZone.show ? [{ label: "Danger zone", swatch: "danger-zone" as const }] : []),
  ];
  const drawIn = {
    isAnimationActive,
    animationDuration: CHART_CONFIG.animation.duration,
    animationEasing: CHART_CONFIG.animation.easing,
  };

  return (
    <div>
      <ChartLegend items={legendItems} />
      <ResponsiveContainer width="100%" height={CHART_CONFIG.height}>
        <LineChart data={mergedData} margin={CHART_CONFIG.margin} accessibilityLayer>
          {/* Horizontal gridlines at Y-axis tick values */}
          <CartesianGrid stroke={CHART_CONFIG.grid.stroke} vertical={CHART_CONFIG.grid.vertical} />

          {/* X-Axis: Time */}
          <XAxis
            dataKey="date"
            type="number"
            domain={[startDate.getTime(), displayEndDate.getTime()]}
            scale="time"
            tickFormatter={formatAxisDate}
            stroke={CHART_CONFIG.baseline.stroke}
            tick={CHART_CONFIG.tick}
            interval="preserveStartEnd"
          />

          {/* Y-Axis: Pace (distance/day or sessions/day) */}
          <YAxis
            label={{
              value: yAxisLabel,
              angle: -90,
              position: "insideLeft",
              fill: CHART_CONFIG.tick.fill,
              style: { fontFamily: CHART_CONFIG.tick.fontFamily, fontSize: 12 },
            }}
            domain={[0, naturalYMax]}
            allowDataOverflow={true}
            stroke={CHART_CONFIG.axis.stroke}
            tick={CHART_CONFIG.tick}
            tickFormatter={(value: number) => value.toFixed(1)}
          />

          {/* Tooltip */}
          <Tooltip content={<ChartTooltip unit={tooltipUnit} decimals={2} />} />

          {/* Danger zone overlay (rendered behind lines) */}
          {dangerZone.show && (
            <DangerZoneOverlay
              threshold={dangerZone.threshold}
              yMax={dangerZone.yMax}
              unitLabel={unitLabel}
            />
          )}

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
              position="right"
            />
          ))}

          {/* Actual pacing line */}
          <Line
            type="monotone"
            {...lineProps(ACTUAL_LINE)}
            style={CHART_CONFIG.actualLineStyle}
            dot={false}
            {...drawIn}
          />

          {/* Pacing goal lines */}
          {goals.map((line, index) => (
            <Line
              key={pacingGoals[index]!.goal.id}
              type="monotone"
              {...lineProps(line)}
              dot={false}
              {...drawIn}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default PacingChartPresenter;
