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
              "border border-[var(--chip)] bg-transparent text-[var(--chip)]",
              "hover:bg-transparent hover:text-[var(--chip)]",
              "data-[pressed]:bg-[var(--chip)] data-[pressed]:text-bg-body"
            )}
          >
            {o.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
