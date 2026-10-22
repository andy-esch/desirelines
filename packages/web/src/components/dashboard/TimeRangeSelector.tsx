import { DASHBOARD_TIME_RANGE_OPTIONS, type DashboardTimeRange } from "../../utils/timeRange";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

interface TimeRangeSelectorProps {
  value: DashboardTimeRange;
  onChange: (range: DashboardTimeRange) => void;
}

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <ToggleGroup
      value={[value]}
      // Clicking the selected range would deselect it; a range is always selected.
      onValueChange={(values) => onChange((values[0] as DashboardTimeRange | undefined) ?? value)}
      aria-label="Time range selector"
      className="p-0.5"
    >
      {DASHBOARD_TIME_RANGE_OPTIONS.map(({ value: rangeValue, short }) => (
        <ToggleGroupItem key={rangeValue} value={rangeValue} className="px-2 py-0.5 text-xs">
          {short}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
