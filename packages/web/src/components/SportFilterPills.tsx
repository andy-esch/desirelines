import { useMemo } from "react";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { SPORT_COLORS, DEFAULT_SPORT_COLOR } from "../utils/sportConfig";
import { sportChipClass, sportChipStyle, SportChipDot } from "./sportChip";
import type { SportOption } from "../hooks/useSportOptions";

interface SportFilterPillsProps {
  /** Sport options, one per category (from useSportOptions). */
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
 * matching the map's per-sport chips and its selection convention: an empty
 * selection means all sports, so deselecting the last chip is the "All Sports" path
 * (there is no dedicated chip for it). Shows the athlete's tracked (visible) sports,
 * not every category, plus every current URL selection, so the filter stays
 * representable. Colors are the fixed `SPORT_COLORS` identities the charts and the map
 * share; chip styling and its contrast rule live in `sportChip.tsx`.
 */
export default function SportFilterPills({
  sportOptions,
  visibleSports,
  selected,
  onChange,
  labelledBy,
}: SportFilterPillsProps) {
  const pills = useMemo(() => {
    const listed = sportOptions.filter(
      (o) => visibleSports.includes(o.value) || selected.includes(o.value)
    );
    // A selection can name a sport the options don't list: the fallback options serve
    // only a few sports while sport config loads, and an old URL can carry a category
    // since removed from the registry. Give it a chip under its raw key so the active
    // filter stays visible and can be deselected.
    const known = new Set(sportOptions.map((o) => o.value));
    const unlisted = selected.filter((s) => !known.has(s)).map((s) => ({ value: s, label: s }));
    return [...listed, ...unlisted];
  }, [sportOptions, visibleSports, selected]);

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
            style={sportChipStyle(color)}
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
