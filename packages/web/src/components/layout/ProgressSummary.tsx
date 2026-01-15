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
    <div className="px-3 pt-3 pb-2">
      <div className="d-flex justify-content-between small">
        <span className="text-muted">Current</span>
        <span className="fw-semibold">{formatValue(currentValue)}</span>
      </div>
      <div className="d-flex justify-content-between small">
        <span className="text-muted">Est. Year-End</span>
        <span className="fw-semibold">{formatValue(estimatedYearEnd)}</span>
      </div>
    </div>
  );
}
