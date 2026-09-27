import { useId } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { VISIBLE_THEMES } from "../../themes/registry";
import { CheckIcon } from "../icons";
import { ThemePreview } from "../theme/ThemePreview";
import { cn } from "@/lib/utils";

interface ThemePickerProps {
  /** The id of the element that names the group (a `SettingRow` in group mode). */
  labelledBy?: string | undefined;
  describedBy?: string | undefined;
}

/**
 * The Settings theme picker: one preview card per theme in the picker's list, as a radio
 * group. Native radios keep the keyboard behaviour (Tab to the chosen card, arrows to move
 * and choose). Choosing applies the theme at once; `ThemeSync` carries it to the account.
 *
 * Each card's thumbnail is drawn in its own theme; the frame, the selection (border, glow,
 * check badge, name color) and the name's case are the page's theme's.
 */
export function ThemePicker({ labelledBy, describedBy }: ThemePickerProps) {
  const { preference, setPreference } = useTheme();
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="grid w-full grid-cols-3 gap-2.5 sm:flex sm:w-auto sm:flex-wrap sm:justify-end"
    >
      {VISIBLE_THEMES.map((theme) => {
        const selected = preference === theme.id;
        return (
          <label key={theme.id} className="flex min-w-0 cursor-pointer flex-col gap-1.5 sm:w-28">
            <input
              type="radio"
              name={name}
              value={theme.id}
              checked={selected}
              onChange={() => setPreference(theme.id)}
              className="peer sr-only"
            />
            <span
              data-selected={selected || undefined}
              className={cn(
                "relative h-14 overflow-hidden rounded-[var(--control-radius)] motion-safe:transition-[border-color,box-shadow]",
                "peer-focus-visible:control-focus-ring",
                selected
                  ? "border-2 border-[var(--color-neon-accent)] shadow-[0_0_12px_color-mix(in_srgb,var(--color-neon-accent)_50%,transparent)]"
                  : "border border-[color-mix(in_srgb,var(--color-muted-text)_40%,transparent)] hover:border-[var(--color-muted-text)]"
              )}
            >
              <ThemePreview theme={theme} />
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute right-[5px] top-[5px] flex size-4 items-center justify-center rounded-[var(--control-radius)] bg-[var(--color-neon-accent)] text-[var(--color-on-accent)]"
                >
                  <CheckIcon size={11} />
                </span>
              )}
            </span>
            <span
              className={cn(
                "truncate text-[11px] [text-transform:var(--control-case)]",
                selected && "text-[var(--color-neon-accent)]"
              )}
            >
              {theme.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
