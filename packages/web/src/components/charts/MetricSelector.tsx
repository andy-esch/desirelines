import { getMetricDisplayLabel } from "../../config/metricConfig";

interface MetricSelectorProps {
  /** Available metric IDs for this sport (e.g., ["distance_meters", "time_minutes", "elevation_meters"]) */
  availableMetrics: string[];
  /** Currently selected metric ID */
  selectedMetric: string;
  /** Callback when metric selection changes */
  onMetricChange: (metricId: string) => void;
}

/**
 * Button group for selecting which metric to display in charts.
 *
 * Shows available metrics for a sport as toggle buttons.
 * Uses Bootstrap button group styling consistent with the view toggle.
 *
 * @example
 * ```tsx
 * <MetricSelector
 *   availableMetrics={["distance_meters", "time_minutes", "elevation_meters"]}
 *   selectedMetric="distance_meters"
 *   onMetricChange={setSelectedMetric}
 * />
 * ```
 */
export default function MetricSelector({
  availableMetrics,
  selectedMetric,
  onMetricChange,
}: MetricSelectorProps) {
  // Don't render if only one metric available
  if (availableMetrics.length <= 1) {
    return null;
  }

  return (
    <div className="btn-group btn-group-sm" role="group" aria-label="Select metric">
      {availableMetrics.map((metricId) => {
        const isSelected = selectedMetric === metricId;
        const label = getMetricDisplayLabel(metricId);

        return (
          <button
            key={metricId}
            type="button"
            className={`btn ${isSelected ? "btn-secondary" : "btn-outline-secondary"}`}
            onClick={() => onMetricChange(metricId)}
            aria-pressed={isSelected}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
