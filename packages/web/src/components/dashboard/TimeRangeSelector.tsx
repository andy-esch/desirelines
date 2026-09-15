import type { TimeRange } from "../../utils/dataNormalization";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "2weeks", label: "2W" },
  { value: "4weeks", label: "4W" },
  { value: "2months", label: "2M" },
  { value: "6months", label: "6M" },
  { value: "ytd", label: "YTD" },
];

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <ToggleGroup
      value={[value]}
      // Clicking the selected range would deselect it; a range is always selected.
      onValueChange={(values) => onChange((values[0] as TimeRange | undefined) ?? value)}
      aria-label="Time range selector"
      className="p-0.5"
    >
      {TIME_RANGE_OPTIONS.map(({ value: rangeValue, label }) => (
        <ToggleGroupItem key={rangeValue} value={rangeValue} className="px-2 py-0.5 text-xs">
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
