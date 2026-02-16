import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { CheckIcon, ChevronDownIcon } from "./icons";

interface SelectOption {
  value: string;
  label: string;
  /** Optional color dot shown before the label */
  dotColor?: string;
}

interface StyledSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
}

/**
 * Styled dropdown select using Headless UI Listbox.
 * Replaces native <select> with a dark-themed, keyboard-accessible dropdown.
 * Supports optional colored dots for each option.
 */
export default function StyledSelect({
  value,
  onChange,
  options,
  disabled = false,
  className = "",
}: StyledSelectProps) {
  const selected = options.find((o) => o.value === value);

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <div className={`relative ${className}`}>
        <ListboxButton className="styled-select-button">
          <span className="flex items-center gap-2 truncate">
            {selected?.dotColor && (
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: selected.dotColor }}
              />
            )}
            <span className="truncate">{selected?.label ?? value}</span>
          </span>
          <ChevronDownIcon className="shrink-0 opacity-50" />
        </ListboxButton>

        <ListboxOptions anchor="bottom start" className="styled-select-options">
          {options.map((option) => (
            <ListboxOption
              key={option.value}
              value={option.value}
              className="styled-select-option data-[focus]:bg-white/8 data-[selected]:text-accent-cyan"
            >
              {({ selected: isSelected }) => (
                <span className="flex items-center gap-2">
                  <span className="w-4 shrink-0 flex justify-center">
                    {isSelected && <CheckIcon />}
                  </span>
                  {option.dotColor && (
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: option.dotColor }}
                    />
                  )}
                  <span className="truncate">{option.label}</span>
                </span>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
