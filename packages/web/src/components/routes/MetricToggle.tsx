import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export interface MetricOption<M extends string> {
  value: M;
  label: string;
}

export interface MetricToggleProps<M extends string> {
  /** The choices, in display order. */
  options: readonly MetricOption<M>[];
  value: M;
  onChange: (metric: M) => void;
  /** Names the group for screen readers, e.g. "Weekly metric". */
  ariaLabel: string;
}

/**
 * The compact single-choice metric switch in a routes insight chart's header
 * (Distance / Time / Count). One option is always pressed: clicking the pressed
 * one again leaves it pressed instead of clearing the choice.
 */
export function MetricToggle<M extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: MetricToggleProps<M>) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(values) => {
        const next = options.find((option) => option.value === values[0]);
        if (next) onChange(next.value);
      }}
      aria-label={ariaLabel}
      className="p-0.5 text-xs"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="px-2 py-0.5">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
