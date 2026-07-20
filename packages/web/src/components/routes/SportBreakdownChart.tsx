import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import type { MapActivity } from "../../api/map";
import { formatDistance, formatHoursMinutes, type DistanceUnit } from "../../utils/units";
import {
  rankedSportBreakdown,
  breakdownValue,
  type BreakdownMetric,
  type SportBreakdownRow,
} from "../../utils/mapInsights";
import { DEFAULT_SPORT_COLOR } from "../../utils/sportConfig";

export interface SportBreakdownChartProps {
  /** The currently-filtered activities (same set the map + summary show). */
  activities: MapActivity[];
  /** App-category → NEON spectrum color (shared with chips + map lines). */
  sportColors: Record<string, string>;
  /** App-category → display label. */
  sportLabels: Record<string, string>;
  distanceUnit: DistanceUnit;
  /** Sports currently selected in the filter (for emphasis). */
  selectedSports: string[];
  /** Click a bar → toggle that sport in the filter (cross-filter). */
  onToggleSport: (sport: string) => void;
}

function formatRowValue(
  row: SportBreakdownRow,
  metric: BreakdownMetric,
  unit: DistanceUnit
): string {
  if (metric === "distance") return formatDistance(row.distanceMeters, unit);
  if (metric === "time") return formatHoursMinutes(row.movingTimeSeconds / 3600);
  return row.count.toLocaleString();
}

/**
 * Sport breakdown — horizontal bars per sport over the filtered set, sized by the
 * selected metric (distance / time / count), colored to match the map. Clicking a
 * bar toggles that sport in the cross-filter. Plain CSS bars (not recharts): a
 * simple proportional breakdown that's lighter, on-brand, and easy to click.
 */
export default function SportBreakdownChart({
  activities,
  sportColors,
  sportLabels,
  distanceUnit,
  selectedSports,
  onToggleSport,
}: SportBreakdownChartProps) {
  const [metric, setMetric] = useState<BreakdownMetric>("distance");
  const rows = useMemo(() => rankedSportBreakdown(activities, metric), [activities, metric]);
  const max = rows.length > 0 ? breakdownValue(rows[0]!, metric) : 0;

  return (
    <section className="px-4 py-3" aria-label="Sport breakdown">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p
          id="insights-sport-label"
          className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-light"
        >
          By sport
        </p>
        <ToggleGroup
          value={[metric]}
          onValueChange={(vals) => {
            const v = vals[0] as BreakdownMetric | undefined;
            if (v) setMetric(v);
          }}
          aria-label="Breakdown metric"
          className="p-0.5 text-xs"
        >
          <ToggleGroupItem value="distance" className="px-2 py-0.5">
            Distance
          </ToggleGroupItem>
          <ToggleGroupItem value="time" className="px-2 py-0.5">
            Time
          </ToggleGroupItem>
          <ToggleGroupItem value="count" className="px-2 py-0.5">
            Count
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-light">No activities to summarize.</p>
      ) : (
        <ul className="space-y-1.5" aria-labelledby="insights-sport-label">
          {rows.map((row) => {
            const value = breakdownValue(row, metric);
            const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
            const color = sportColors[row.sport] ?? DEFAULT_SPORT_COLOR;
            const isSelected = selectedSports.includes(row.sport);
            const dimmed = selectedSports.length > 0 && !isSelected;
            return (
              <li key={row.sport}>
                <button
                  type="button"
                  onClick={() => onToggleSport(row.sport)}
                  aria-pressed={isSelected}
                  style={{ "--bar": color } as CSSProperties}
                  className={cn(
                    "group block w-full rounded-md px-1.5 py-1 text-left transition-opacity",
                    "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50",
                    dimmed && "opacity-40 hover:opacity-100"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate text-body-text">
                      {sportLabels[row.sport] ?? row.sport}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-light">
                      {formatRowValue(row, metric, distanceUnit)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="sport-mark h-full rounded-full bg-[var(--bar)]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
