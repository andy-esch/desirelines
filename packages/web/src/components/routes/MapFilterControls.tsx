import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Slider } from "../ui/slider";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Button } from "../ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { cn } from "@/lib/utils";
import { type RouteFilterState, yearRange } from "../../utils/routeFilters";
import type { RegionSummary } from "../../api/map";
import { convertDistance, getDistanceLabel, type DistanceUnit } from "../../utils/units";
import { SportVisibilityHint } from "../SportVisibilityHint";
import { sportChipClass, SportChipDot } from "../sportChip";

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
  /** The user's configured visible sports (from the shared `useVisibleSports`
   *  preference) — powers the one-tap "My sports" preset. The control narrows this
   *  to sports present in `sportOptions`; when the result is empty, or equals all
   *  present sports, the preset is hidden. */
  mySports: string[];
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
  /** Regions (name + activity count + bbox) from `/map/regions`, for the region filter. */
  regions: RegionSummary[];
  /** Currently-filtered region id (null = all regions). */
  selectedRegionId: number | null;
  /** Select a region (filter + frame it); `null` = all regions. */
  onSelectRegion: (regionId: number | null) => void;
  /** Greyed + non-interactive when the dataset is empty (owner decision). */
  disabled?: boolean;
}

const ALL_REGIONS = "all";

const ALL_TIME = "all";

/** True when two sport selections are the same set (order-independent). Inputs are
 *  duplicate-free selections, so an equal length + one-way subset check is exact —
 *  and a Set avoids both a delimiter-join's collision risk and its sort cost. */
function sameSportSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((x) => setA.has(x));
}

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
 * The routes-map filter controls: year quick-select, region (name + count), sport
 * multi-select, and a distance range — all driving `useRouteFilters` setters.
 * Mounts in the drawer's scroll area. (The granular two-thumb time-range slider +
 * date inputs are a sibling control, `MapTimeRangeFilter`, rendered below the list.)
 *
 * All controls are **disabled/greyed** when the dataset is empty so the feature
 * stays visible (communicates intent) rather than vanishing.
 */
export default function MapFilterControls({
  filters,
  sportOptions,
  mySports,
  distanceDomain,
  dateDomain,
  distanceUnit,
  now,
  onSportsChange,
  onDistanceChange,
  onSelectYear,
  onSelectAllTime,
  regions,
  selectedRegionId,
  onSelectRegion,
  disabled = false,
}: MapFilterControlsProps) {
  // Stable across renders (a bare `now ?? new Date()` would churn useMemo deps).
  const today = useMemo(() => now ?? new Date(), [now]);
  const currentYear = today.getFullYear();

  // "My sports" preset: one-tap apply of the user's configured visible-sports. Defend
  // against a caller passing sports absent from the dataset by narrowing to those that
  // actually have a chip — so the length check below is a true "proper subset" test and
  // clicking can't select an unrenderable sport. Meaningful only as a proper subset: if
  // it equals all present sports it's the same as "All"/clear, so we hide it.
  const presentMySports = useMemo(() => {
    const optionValues = new Set(sportOptions.map((o) => o.value));
    return mySports.filter((s) => optionValues.has(s));
  }, [mySports, sportOptions]);
  const showMySports = presentMySports.length > 0 && presentMySports.length < sportOptions.length;
  const myActive = showMySports && sameSportSet(filters.sports, presentMySports);

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

  // Regions for the dropdown, densest first (name + activity count).
  const regionsSorted = useMemo(
    () => [...regions].sort((a, b) => b.activityCount - a.activityCount),
    [regions]
  );

  const distanceMax = Math.max(1, distanceDomain[1]);
  const distanceValue: [number, number] = filters.distanceRange ?? [0, distanceMax];
  const unitLabel = getDistanceLabel(distanceUnit);
  const fmt = (m: number) => Math.round(convertDistance(m, distanceUnit));
  // Step ≈ 1% of the range (min 100 m) so the slider is smooth but not jittery.
  const distanceStep = Math.max(100, Math.round(distanceMax / 100));

  // The distance slider is `value`-controlled off the filter state, which now lives in
  // the URL — committing on every drag tick would fire a navigate() per frame. Keep a
  // local "draft" for a smooth thumb during the drag and commit (→ filter/URL) only on
  // release; drop the draft once the committed value round-trips back through the prop,
  // so the thumb never flickers back to the pre-commit position.
  const [distanceDraft, setDistanceDraft] = useState<[number, number] | null>(null);
  // Drop the draft once the committed value has round-tripped back through the prop.
  // Adjusting state *during render* (React's documented alternative to a syncing
  // effect) — React re-renders immediately without committing the intermediate DOM,
  // so there's no cascading render and the thumb never flickers to the old position.
  if (
    distanceDraft &&
    distanceDraft[0] === distanceValue[0] &&
    distanceDraft[1] === distanceValue[1]
  ) {
    setDistanceDraft(null);
  }
  const sliderDistance = distanceDraft ?? distanceValue;

  return (
    <div
      className={cn("divide-y divide-border/60", disabled && "pointer-events-none opacity-50")}
      aria-disabled={disabled || undefined}
    >
      {/* Year quick-select — the primary filter, kept at the top + emphasized. */}
      <Section
        label="When"
        htmlId="filter-year-label"
        action={
          // The granular date slider can set a window matching no year chip → the
          // group shows nothing pressed, which reads as a bug. Label it "Custom".
          selectedYearKey === "" ? (
            <span className="text-[0.65rem] font-medium uppercase tracking-wider text-accent-cyan">
              Custom range
            </span>
          ) : undefined
        }
      >
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

      {/* Region — name + activity count; selecting filters + frames it. */}
      {regionsSorted.length > 0 && (
        <Section label="Region" htmlId="filter-region-label">
          <Select
            value={selectedRegionId === null ? ALL_REGIONS : String(selectedRegionId)}
            onValueChange={(v) => onSelectRegion(v === ALL_REGIONS ? null : Number(v))}
            disabled={disabled}
          >
            <SelectTrigger aria-labelledby="filter-region-label">
              {/* Format the selected value as the region's name + count (otherwise
                  Base UI renders the raw value — the region id). */}
              <SelectValue>
                {(value) => {
                  if (value == null || value === ALL_REGIONS) return "All regions";
                  const r = regionsSorted.find((x) => String(x.regionId) === String(value));
                  return r ? `${r.name} (${r.activityCount.toLocaleString()})` : "All regions";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_REGIONS}>All regions</SelectItem>
              {regionsSorted.map((r) => (
                <SelectItem key={r.regionId} value={String(r.regionId)}>
                  {r.name} ({r.activityCount.toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      )}

      {/* Sport (multi-select) */}
      {sportOptions.length > 0 && (
        <Section
          label="Sport"
          htmlId="filter-sport-label"
          action={
            showMySports || filters.sports.length > 0 ? (
              <div className="flex items-center gap-1">
                {showMySports && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={myActive}
                    // A true toggle: apply the preset, or (when already active) clear
                    // back to all sports. Keeps `aria-pressed` honest and avoids the
                    // dead re-render a re-apply-the-same-set click would cause.
                    onClick={() => onSportsChange(myActive ? [] : presentMySports)}
                    disabled={disabled}
                    className={cn(
                      "h-auto px-1.5 py-0.5 text-[0.7rem] hover:text-body-text",
                      myActive ? "text-body-text" : "text-slate-light"
                    )}
                  >
                    My sports
                  </Button>
                )}
                {filters.sports.length > 0 && (
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
                )}
              </div>
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
              // Same treatment as the Charts/List sport chips: neutral label, glowing
              // sport-color dot, neon fill when selected. The label used to wear the
              // sport color itself, which is unreadable on the light ground.
              <ToggleGroupItem
                key={s.value}
                value={s.value}
                style={{ "--chip": s.color } as CSSProperties}
                className={cn(sportChipClass, "transition-colors")}
              >
                <SportChipDot />
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {/* Points at the same visible-sports config the "My sports" preset reads. */}
          <SportVisibilityHint className="mt-2" />
        </Section>
      )}

      {/* Distance range */}
      <Section label="Distance" htmlId="filter-distance-label">
        <Slider
          aria-labelledby="filter-distance-label"
          min={0}
          max={distanceMax}
          step={distanceStep}
          value={sliderDistance}
          disabled={disabled}
          // Screen readers hear "50 mi" (unit-aware), not the raw meter value.
          getAriaValueText={(_, v) => `${fmt(v)} ${unitLabel}`}
          // Live thumb only — cheap local state, no filter/URL write per tick.
          onValueChange={(vals) => {
            const next = vals as number[];
            setDistanceDraft([next[0] ?? 0, next[1] ?? distanceMax]);
          }}
          // Commit once, on release (pointer-up / keyboard step) → writes the filter (URL).
          onValueCommitted={(vals) => {
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
            {fmt(sliderDistance[0])} {unitLabel}
          </span>
          <span>
            {fmt(sliderDistance[1])} {unitLabel}
          </span>
        </div>
      </Section>
    </div>
  );
}
