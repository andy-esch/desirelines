import { getMetricDisplayLabel } from "../../config/metricConfig";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

interface MetricSelectorProps {
  /** Available metric IDs for this sport (e.g., ["distance_meters", "time_minutes", "elevation_meters"]) */
  availableMetrics: string[];
  /** Currently selected metric ID */
  selectedMetric: string;
  /** Callback when metric selection changes */
  onMetricChange: (metricId: string) => void;
}

/**
 * Single-select toggle for which metric a chart displays. Shared by the Charts view and
 * the sport detail pages. Renders nothing when there's only one metric to choose.
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
  if (availableMetrics.length <= 1) {
    return null;
  }

  return (
    <ToggleGroup
      value={[selectedMetric]}
      onValueChange={(vals) => {
        const v = vals[0];
        if (v) onMetricChange(v); // ignore deselect-to-empty; a metric is always active
      }}
      aria-label="Select metric"
    >
      {availableMetrics.map((metricId) => (
        <ToggleGroupItem key={metricId} value={metricId}>
          {getMetricDisplayLabel(metricId)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
