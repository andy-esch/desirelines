import type { MetricUnit } from "../../utils/units";
import { tint } from "../../utils/colorTokens";

interface ProgressSummaryProps {
  /** Current cumulative value (distance or session count) */
  currentValue: number;
  estimatedYearEnd: number;
  unit: MetricUnit;
  isLoading?: boolean;
}

/**
 * Displays current progress and estimated year-end totals.
 * Used at the top of the sidebar to provide key context.
 */
export default function ProgressSummary({
  currentValue,
  estimatedYearEnd,
  unit,
  isLoading = false,
}: ProgressSummaryProps) {
  const formatValue = (value: number): string => {
    if (isLoading) return "--";
    if (value === 0) return "--"; // No data yet for this metric
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unit}`;
  };

  return (
    <div className="px-4 pt-4 pb-2">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-text">Current</span>
        <span className="font-semibold">{formatValue(currentValue)}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-text">Est. Year-End</span>
        {/* Same face and weight as the value above it: these are a pair, read together, and
            the display face is for headlines and big numbers. The glow is what marks this one
            as the projection. It takes the theme's decorative accent, the role for glows,
            rather than the brand cyan: this sidebar is themed, unlike the header, which is
            pinned dark whatever the theme. */}
        <span
          className="font-semibold"
          style={{ textShadow: `0 0 12px ${tint("--color-neon-accent", 20)}` }}
        >
          {formatValue(estimatedYearEnd)}
        </span>
      </div>
    </div>
  );
}
