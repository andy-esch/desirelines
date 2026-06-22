import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface SelectOption {
  value: string;
  label: string;
}

interface StyledSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  /** Associates an external label with this select via htmlFor */
  id?: string;
  /** Associates an external label with this select for accessibility */
  "aria-labelledby"?: string;
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
}: StyledSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as string)} disabled={disabled}>
      <SelectTrigger id={id} aria-labelledby={ariaLabelledBy} className={className}>
        <SelectValue>
          {(val) => options.find((o) => o.value === val)?.label ?? (val == null ? "" : String(val))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
