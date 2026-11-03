import { useMemo, useState } from "react";
import type { MapActivity } from "../../api/map";
import { formatDistance, type DistanceUnit } from "../../utils/units";
import { regionBreakdown } from "../../utils/mapInsights";
import { BreakdownBarRow, breakdownBarPct } from "./BreakdownBarRow";
import { InsightSection } from "./InsightSection";
import { MetricToggle, type MetricOption } from "./MetricToggle";

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

const REGION_METRICS: readonly MetricOption<RegionMetric>[] = [
  { value: "distance", label: "Distance" },
  { value: "count", label: "Count" },
];

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
    <InsightSection
      title="By region"
      ariaLabel="Region breakdown"
      headerSpacing="mb-3"
      isEmpty={rows.length === 0}
      emptyText="No region data."
      action={
        <MetricToggle
          options={REGION_METRICS}
          value={metric}
          onChange={setMetric}
          ariaLabel="Region metric"
        />
      }
    >
      <ul className="space-y-1.5">
        {rows.map((row) => {
          const value = metric === "distance" ? row.distanceMeters : row.count;
          const isSelected = row.regionId === selectedRegionId;
          return (
            <BreakdownBarRow
              key={row.regionId}
              label={regionNames[row.regionId] ?? `Region ${row.regionId}`}
              value={
                metric === "distance"
                  ? formatDistance(row.distanceMeters, distanceUnit)
                  : row.count.toLocaleString()
              }
              pct={breakdownBarPct(value, max)}
              isSelected={isSelected}
              dimmed={selectedRegionId !== null && !isSelected}
              onClick={() => onSelectRegion(isSelected ? null : row.regionId)}
            />
          );
        })}
      </ul>
    </InsightSection>
  );
}
