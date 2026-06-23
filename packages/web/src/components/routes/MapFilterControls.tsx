import { useMemo } from "react";
import type { CSSProperties } from "react";
import { Slider } from "../ui/slider";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { type RouteFilterState, yearRange } from "../../utils/routeFilters";
import { convertDistance, getDistanceLabel, type DistanceUnit } from "../../utils/units";

/** A selectable sport: app-category key + display label + legend color. */
export interface SportOption {
  value: string;
  label: string;
  color: string;
}

export interface MapFilterControlsProps {
  filters: RouteFilterState;
  /** App-category sports present in the dataset (derived in the page). */
  sportOptions: SportOption[];
  /** `[0, maxMeters]` over the full dataset — the distance slider domain. */
  distanceDomain: [number, number];
  /** `[earliest, today]` over the full dataset — drives the year quick-select. */
  dateDomain: [string, string];
  distanceUnit: DistanceUnit;
  /** "now" injection for deterministic tests (year list + current-year clamp). */
  now?: Date;
  onSportsChange: (sports: string[]) => void;
  onDistanceChange: (range: [number, number] | null) => void;
  onSelectYear: (year: number) => void;
  /** Widen the date window to the full domain (the "All" year chip). */
  onSelectAllTime: () => void;
  /** Greyed + non-interactive when the dataset is empty (owner decision). */
  disabled?: boolean;
}

const ALL_TIME = "all";

function Section({
  label,
  htmlId,
  action,
  children,
}: {
  label: string;
  htmlId?: string;
  /** Optional control rendered at the right of the section label (e.g. Clear). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p
          id={htmlId}
          className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-light"
        >
          {label}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * The routes-map filter controls (step 2): sport multi-select, a year
 * quick-select, and a distance range — all driving `useRouteFilters` setters.
 * Mounts in the drawer's scroll area. The time-range two-thumb slider + date
 * inputs and the region filter are a follow-on (see the task).
 *
 * All controls are **disabled/greyed** when the dataset is empty so the feature
 * stays visible (communicates intent) rather than vanishing.
 */
export default function MapFilterControls({
  filters,
  sportOptions,
  distanceDomain,
  dateDomain,
  distanceUnit,
  now,
  onSportsChange,
  onDistanceChange,
  onSelectYear,
  onSelectAllTime,
  disabled = false,
}: MapFilterControlsProps) {
  // Stable across renders (a bare `now ?? new Date()` would churn useMemo deps).
  const today = useMemo(() => now ?? new Date(), [now]);
  const currentYear = today.getFullYear();

  // Years present in the data (earliest → current), newest first, for the
  // quick-select. Plus an "All" chip that widens to the full date domain.
  const years = useMemo(() => {
    const earliest = Number(dateDomain[0].slice(0, 4)) || currentYear;
    const list: number[] = [];
    for (let y = currentYear; y >= earliest; y--) list.push(y);
    return list;
  }, [dateDomain, currentYear]);

  // Which chip is selected: the year whose [Jan 1 … Dec 31/today] range matches
  // the active window, "all" when it spans the full domain, else none (a custom
  // range set elsewhere — e.g. a future date slider).
  const selectedYearKey = useMemo(() => {
    const [s, e] = filters.dateRange;
    if (s === dateDomain[0] && e === dateDomain[1]) return ALL_TIME;
    for (const y of years) {
      const [ys, ye] = yearRange(y, today);
      if (s === ys && e === ye) return String(y);
    }
    return "";
  }, [filters.dateRange, dateDomain, years, today]);

  const distanceMax = Math.max(1, distanceDomain[1]);
  const distanceValue: [number, number] = filters.distanceRange ?? [0, distanceMax];
  const unitLabel = getDistanceLabel(distanceUnit);
  const fmt = (m: number) => Math.round(convertDistance(m, distanceUnit));
  // Step ≈ 1% of the range (min 100 m) so the slider is smooth but not jittery.
  const distanceStep = Math.max(100, Math.round(distanceMax / 100));

  return (
    <div
      className={cn("divide-y divide-border/60", disabled && "pointer-events-none opacity-50")}
      aria-disabled={disabled || undefined}
    >
      {/* Year quick-select — the primary filter, kept at the top + emphasized. */}
      <Section label="When" htmlId="filter-year-label">
        <ToggleGroup
          value={selectedYearKey ? [selectedYearKey] : []}
          onValueChange={(vals) => {
            const v = vals[0];
            if (!v) return; // ignore deselect-to-empty; a window is always active
            if (v === ALL_TIME) onSelectAllTime();
            else onSelectYear(Number(v));
          }}
          aria-labelledby="filter-year-label"
          disabled={disabled}
          className="flex-wrap text-base"
        >
          <ToggleGroupItem value={ALL_TIME}>All</ToggleGroupItem>
          {years.map((y) => (
            <ToggleGroupItem key={y} value={String(y)}>
              {y}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      {/* Sport (multi-select) */}
      {sportOptions.length > 0 && (
        <Section
          label="Sport"
          htmlId="filter-sport-label"
          action={
            filters.sports.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSportsChange([])}
                disabled={disabled}
                className="h-auto gap-1 px-1.5 py-0.5 text-[0.7rem] text-slate-light hover:text-body-text"
              >
                Clear
                <span aria-hidden="true">✕</span>
              </Button>
            ) : undefined
          }
        >
          <ToggleGroup
            multiple
            value={filters.sports}
            onValueChange={(vals) => onSportsChange(vals)}
            aria-labelledby="filter-sport-label"
            disabled={disabled}
            className="flex-wrap"
          >
            {sportOptions.map((s) => (
              // Each chip wears its sport's NEON spectrum color (same as the map
              // line): outlined + colored when off, filled when selected.
              <ToggleGroupItem
                key={s.value}
                value={s.value}
                style={{ "--chip": s.color } as CSSProperties}
                className={cn(
                  "border border-[var(--chip)] bg-transparent text-[var(--chip)] transition-colors",
                  "hover:bg-transparent hover:text-[var(--chip)]",
                  "data-[pressed]:bg-[var(--chip)] data-[pressed]:text-bg-body"
                )}
              >
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Section>
      )}

      {/* Distance range */}
      <Section label="Distance" htmlId="filter-distance-label">
        <Slider
          aria-labelledby="filter-distance-label"
          min={0}
          max={distanceMax}
          step={distanceStep}
          value={distanceValue}
          disabled={disabled}
          onValueChange={(vals) => {
            const next = vals as number[];
            const lo = next[0] ?? 0;
            const hi = next[1] ?? distanceMax;
            // Spanning the full domain = no constraint → clear (keeps the active
            // badge honest; mirrors useRouteFilters' distance logic).
            onDistanceChange(lo <= 0 && hi >= distanceMax ? null : [lo, hi]);
          }}
        />
        <div className="mt-1 flex justify-between text-xs tabular-nums text-slate-light">
          <span>
            {fmt(distanceValue[0])} {unitLabel}
          </span>
          <span>
            {fmt(distanceValue[1])} {unitLabel}
          </span>
        </div>
      </Section>
    </div>
  );
}
