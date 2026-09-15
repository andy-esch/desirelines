import type { CSSProperties } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

/**
 * Base UI treats `""` as no selection and marks the trigger as a placeholder, so an option
 * whose value is `""` (e.g. "Browser Default") uses this stand-in inside the select.
 */
const EMPTY_VALUE = "__styled-select-empty__";
const toSelectValue = (value: string) => (value === "" ? EMPTY_VALUE : value);
const fromSelectValue = (value: string) => (value === EMPTY_VALUE ? "" : value);

interface SelectOption {
  value: string;
  label: string;
}

interface StyledSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  className?: string;
  /** Associates an external label with this select via htmlFor */
  id?: string | undefined;
  /** Associates an external label with this select for accessibility */
  "aria-labelledby"?: string;
  /** Names the select when no visible label exists */
  "aria-label"?: string;
  /** Points at help text that describes the select */
  "aria-describedby"?: string | undefined;
  /** Inline trigger styles, e.g. a fixed width */
  style?: CSSProperties;
}

/**
 * Styled dropdown select. Thin convenience wrapper over the Base UI `Select`
 * primitives (`@/components/ui/select`) with a simple `value`/`onChange`/`options`
 * API. Migrated off Headless UI Listbox.
 */
export default function StyledSelect({
  value,
  onChange,
  options,
  disabled = false,
  className = "",
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  style,
}: StyledSelectProps) {
  return (
    <Select
      value={toSelectValue(value)}
      onValueChange={(v) => onChange(fromSelectValue(v as string))}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        className={className}
        style={style}
      >
        <SelectValue>
          {(val) =>
            options.find((o) => toSelectValue(o.value) === val)?.label ??
            (val == null ? "" : String(val))
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={toSelectValue(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
