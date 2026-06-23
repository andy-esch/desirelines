import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import type { MapActivity } from "../../api/map";
import { formatDistance, type DistanceUnit } from "../../utils/units";
import { regionBreakdown } from "../../utils/mapInsights";

type RegionMetric = "distance" | "count";

export interface RegionBreakdownChartProps {
  activities: MapActivity[];
  /** region id → display name (from /map/regions). */
  regionNames: Record<number, string>;
  distanceUnit: DistanceUnit;
  /** Currently-filtered region id (null = all). */
  selectedRegionId: number | null;
  /** Click a region → filter to it (cross-filter + frame). */
  onSelectRegion: (regionId: number | null) => void;
  /** Cap the number of bars shown (rest omitted). */
  limit?: number;
}

/**
 * Region breakdown — bars per geographic region over the filtered set (distance or
 * count). An activity counts in each region it's tagged to. Clicking a bar filters
 * to that region (toggles off if already selected). Plain CSS bars, like the sport
 * breakdown; the active region is emphasized.
 */
export default function RegionBreakdownChart({
  activities,
  regionNames,
  distanceUnit,
  selectedRegionId,
  onSelectRegion,
  limit = 8,
}: RegionBreakdownChartProps) {
  const [metric, setMetric] = useState<RegionMetric>("distance");
  const rows = useMemo(() => {
    const all = regionBreakdown(activities).sort((a, b) =>
      metric === "distance" ? b.distanceMeters - a.distanceMeters : b.count - a.count
    );
    return all.slice(0, limit);
  }, [activities, metric, limit]);
  const max =
    rows.length > 0 ? (metric === "distance" ? rows[0]!.distanceMeters : rows[0]!.count) : 0;

  return (
    <section className="px-4 py-3" aria-label="Region breakdown">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-light">
          By region
        </p>
        <ToggleGroup
          value={[metric]}
          onValueChange={(vals) => {
            const v = vals[0] as RegionMetric | undefined;
            if (v) setMetric(v);
          }}
          aria-label="Region metric"
          className="p-0.5 text-xs"
        >
          <ToggleGroupItem value="distance" className="px-2 py-0.5">
            Distance
          </ToggleGroupItem>
          <ToggleGroupItem value="count" className="px-2 py-0.5">
            Count
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-light">No region data.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const value = metric === "distance" ? row.distanceMeters : row.count;
            const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
            const isSelected = row.regionId === selectedRegionId;
            const dimmed = selectedRegionId !== null && !isSelected;
            return (
              <li key={row.regionId}>
                <button
                  type="button"
                  onClick={() => onSelectRegion(isSelected ? null : row.regionId)}
                  aria-pressed={isSelected}
                  className={cn(
                    "group block w-full rounded-md px-1.5 py-1 text-left transition-opacity",
                    "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50",
                    dimmed && "opacity-40 hover:opacity-100"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate text-body-text">
                      {regionNames[row.regionId] ?? `Region ${row.regionId}`}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-light">
                      {metric === "distance"
                        ? formatDistance(row.distanceMeters, distanceUnit)
                        : row.count.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-accent-cyan"
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
