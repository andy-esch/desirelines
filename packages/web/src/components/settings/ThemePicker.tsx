import { useId, type ReactNode } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import {
  MATCH_SYSTEM_LABEL,
  SYSTEM_THEME_IDS,
  VISIBLE_THEMES,
  getTheme,
  type ThemePreference,
} from "../../themes/registry";
import { CheckIcon } from "../icons";
import { ThemePreview } from "../theme/ThemePreview";
import { cn } from "@/lib/utils";

interface ThemePickerProps {
  /** The id of the element that names the group (a `SettingRow` in group mode). */
  labelledBy?: string | undefined;
  describedBy?: string | undefined;
}

/** "Match system" drawn as its two themes, split corner to corner: dark above, light below. */
function MatchSystemPreview() {
  return (
    <>
      <span className="absolute inset-0 [clip-path:polygon(0_0,100%_0,0_100%)]">
        <ThemePreview theme={getTheme(SYSTEM_THEME_IDS.dark)} />
      </span>
      <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
        <ThemePreview theme={getTheme(SYSTEM_THEME_IDS.light)} />
      </span>
    </>
  );
}

/**
 * The Settings theme picker: one preview card per theme in the picker's list, then "Match
 * system", as a radio group. Native radios keep the keyboard behaviour (Tab to the chosen
 * card, arrows to move and choose). Choosing applies the theme at once; signed in,
 * `ThemeSync` carries it to the account, and in demo mode it stays the demo's own.
 *
 * Each card's thumbnail is drawn in its own theme ("Match system" in both of its themes);
 * the frame, the selection (border, glow, check badge, name color) and the name's case are
 * the page's theme's.
 */
export function ThemePicker({ labelledBy, describedBy }: ThemePickerProps) {
  const { preference, setPreference } = useTheme();
  const name = useId();
  const cards: readonly { value: ThemePreference; label: string; preview: ReactNode }[] = [
    ...VISIBLE_THEMES.map((theme) => ({
      value: theme.id,
      label: theme.label,
      preview: <ThemePreview theme={theme} />,
    })),
    { value: "system", label: MATCH_SYSTEM_LABEL, preview: <MatchSystemPreview /> },
  ];

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="grid w-full grid-cols-3 gap-2.5 sm:flex sm:w-auto sm:flex-wrap sm:justify-end"
    >
      {cards.map(({ value, label, preview }) => {
        const selected = preference === value;
        return (
          <label key={value} className="flex min-w-0 cursor-pointer flex-col gap-1.5 sm:w-28">
            <input
              type="radio"
              name={name}
              value={value}
              checked={selected}
              onChange={() => setPreference(value)}
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
              {preview}
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
              {label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
