import type { MetricUnit } from "../../utils/units";

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
    if (isLoading || value === 0) return "--";
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unit}`;
  };

  return (
    <div className="px-6 pt-6 pb-2">
      <div className="flex justify-between text-sm">
        <span className="text-slate-light">Current</span>
        <span className="font-semibold">{formatValue(currentValue)}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-light">Est. Year-End</span>
        <span className="font-semibold">{formatValue(estimatedYearEnd)}</span>
      </div>
    </div>
  );
}
