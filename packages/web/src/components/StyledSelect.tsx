import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";

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

const ChevronIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="currentColor"
    className="shrink-0 opacity-50"
  >
    <path d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
  </svg>
);

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
          <ChevronIcon />
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
