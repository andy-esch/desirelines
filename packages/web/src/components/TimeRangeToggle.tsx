import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { coerceTimeRange, TIME_RANGE_OPTIONS, type TimeRange } from "../utils/timeRange";

interface TimeRangeToggleProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  /** Id of the visible "Time:" label, so the group is named without repeating it. */
  labelledBy: string;
}

/**
 * The activities-group time range as one segmented control, matching the dashboard's.
 * Each item shows a short form and is named by the full one, so "2W" reads as "2 Weeks".
 */
export function TimeRangeToggle({ value, onChange, labelledBy }: TimeRangeToggleProps) {
  return (
    <ToggleGroup
      value={[value]}
      // Clicking the selected range would deselect it; a range is always selected.
      onValueChange={(values) => onChange(coerceTimeRange(values[0], value))}
      aria-labelledby={labelledBy}
      className="p-0.5"
    >
      {TIME_RANGE_OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.label}
          className="px-2 py-0.5 text-xs"
        >
          {option.short}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
