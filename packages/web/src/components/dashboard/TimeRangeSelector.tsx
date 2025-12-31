import type { TimeRange } from "../../utils/dataNormalization";

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
    <div className="btn-group btn-group-sm" role="group" aria-label="Time range selector">
      {TIME_RANGE_OPTIONS.map(({ value: rangeValue, label }) => (
        <button
          key={rangeValue}
          type="button"
          className={`btn ${value === rangeValue ? "btn-time-range-active" : "btn-time-range"}`}
          onClick={() => onChange(rangeValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
