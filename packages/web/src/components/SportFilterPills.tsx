import { useMemo, type CSSProperties } from "react";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { SPORT_COLORS, DEFAULT_SPORT_COLOR } from "../utils/sportConfig";
import { cn } from "@/lib/utils";

interface SportOption {
  value: string;
  label: string;
}

interface SportFilterPillsProps {
  /** All sport options including the "" All-Sports entry (which is filtered out here). */
  sportOptions: SportOption[];
  /** The athlete's tracked sports — chips are limited to these (plus the current selection). */
  visibleSports: string[];
  /** The single selected sport ("" = all sports). */
  selected: string;
  /** New sport, or "" when the active chip is deselected (→ all sports). */
  onChange: (sport: string) => void;
  /** id of the label element that names this group (for aria-labelledby). */
  labelledBy: string;
}

/**
 * Single-select sport chips for the Activities-group content views (List + Charts),
 * matching the map's neon per-sport chips. Shows the athlete's tracked (visible) sports —
 * not every category — plus the current URL selection if it falls outside that set, so the
 * filter stays representable. (Colors use the fixed `SPORT_COLORS` so a chip matches the
 * chart bar beside it; unifying with the map's positional colors is a separate task.)
 *
 * The sport color is an accent, not the text: full-brightness neon on the light ground
 * fails 3:1 for 14 of the 16 sports, so an unselected chip pairs a neutral label with a
 * glowing dot + neon-tinted hairline, and a selected one turns the neon into the fill.
 * That keeps the palette acid-bright in both themes without muting it to make it legible.
 */
export default function SportFilterPills({
  sportOptions,
  visibleSports,
  selected,
  onChange,
  labelledBy,
}: SportFilterPillsProps) {
  const pills = useMemo(
    () =>
      sportOptions.filter(
        (o) => o.value && (visibleSports.includes(o.value) || o.value === selected)
      ),
    [sportOptions, visibleSports, selected]
  );

  return (
    <ToggleGroup
      value={selected ? [selected] : []}
      onValueChange={(vals) => onChange(vals[0] ?? "")}
      aria-labelledby={labelledBy}
      className="flex-wrap"
    >
      {pills.map((o) => {
        const color = SPORT_COLORS[o.value] ?? DEFAULT_SPORT_COLOR;
        return (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            style={{ "--chip": color } as CSSProperties}
            className={cn(
              "group",
              // Unselected: the label is a neutral theme token, never the sport color —
              // the neon is carried by the glowing dot and a hairline tinted toward it.
              "border border-[color-mix(in_srgb,var(--chip)_55%,var(--color-chip-hairline))]",
              "bg-transparent text-foreground",
              "hover:bg-[color-mix(in_srgb,var(--chip)_10%,transparent)] hover:text-foreground",
              // Selected: neon becomes the fill. The label pins to a fixed dark ink
              // rather than bg-body, which is *light* in light mode (light-on-neon).
              "data-[pressed]:border-transparent data-[pressed]:bg-[var(--chip)] data-[pressed]:text-sport-on"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full bg-[var(--chip)]",
                "shadow-[0_0_7px_var(--chip),0_0_2px_var(--chip)]",
                // On the bright fill the glow has nothing to glow against; the dot
                // inverts to the label ink so the chip's width doesn't shift on toggle.
                "group-data-[pressed]:bg-sport-on group-data-[pressed]:shadow-none"
              )}
            />
            {o.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
