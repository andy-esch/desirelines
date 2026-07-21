import { useMemo, type CSSProperties } from "react";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { SPORT_COLORS, DEFAULT_SPORT_COLOR } from "../utils/sportConfig";
import { sportChipClass, SportChipDot } from "./sportChip";

interface SportOption {
  value: string;
  label: string;
}

interface SportFilterPillsProps {
  /** All sport options including the "" All-Sports entry (which is filtered out here). */
  sportOptions: SportOption[];
  /** The athlete's tracked sports — chips are limited to these (plus current selections). */
  visibleSports: string[];
  /** The selected sport categories (empty = all sports). */
  selected: string[];
  /** The new selection; deselecting the last chip yields [] (→ all sports). */
  onChange: (sports: string[]) => void;
  /** id of the label element that names this group (for aria-labelledby). */
  labelledBy: string;
}

/**
 * Multi-select sport chips for the Activities-group content views (List + Charts),
 * matching the map's neon per-sport chips and its selection convention: an empty
 * selection means all sports, so deselecting the last chip is the "All Sports" path
 * (there is no dedicated chip for it). Shows the athlete's tracked (visible) sports —
 * not every category — plus any current URL selections outside that set, so the
 * filter stays representable. (Colors use the fixed `SPORT_COLORS` so a chip matches
 * the chart bar beside it; unifying with the map's positional colors is a separate
 * task.)
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
        (o) => o.value && (visibleSports.includes(o.value) || selected.includes(o.value))
      ),
    [sportOptions, visibleSports, selected]
  );

  return (
    <ToggleGroup
      multiple
      value={selected}
      onValueChange={(vals) => onChange(vals)}
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
            className={sportChipClass}
          >
            <SportChipDot />
            {o.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
