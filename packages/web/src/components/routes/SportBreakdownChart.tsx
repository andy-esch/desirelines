import { useMemo, useState } from "react";
import type { MapActivity } from "../../api/map";
import { formatDistance, formatHoursMinutes, type DistanceUnit } from "../../utils/units";
import {
  rankedSportBreakdown,
  breakdownValue,
  type BreakdownMetric,
  type SportBreakdownRow,
} from "../../utils/mapInsights";
import { DEFAULT_SPORT_COLOR } from "../../utils/sportConfig";
import { InsightSection } from "./InsightSection";
import { MetricToggle, type MetricOption } from "./MetricToggle";
import { BreakdownBarRow, breakdownBarPct } from "./BreakdownBarRow";

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

const SPORT_METRICS: readonly MetricOption<BreakdownMetric>[] = [
  { value: "distance", label: "Distance" },
  { value: "time", label: "Time" },
  { value: "count", label: "Count" },
];

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
    <InsightSection
      title="By sport"
      ariaLabel="Sport breakdown"
      labelId="insights-sport-label"
      headerSpacing="mb-3"
      isEmpty={rows.length === 0}
      action={
        <MetricToggle
          options={SPORT_METRICS}
          value={metric}
          onChange={setMetric}
          ariaLabel="Breakdown metric"
        />
      }
    >
      <ul className="space-y-1.5" aria-labelledby="insights-sport-label">
        {rows.map((row) => {
          const isSelected = selectedSports.includes(row.sport);
          return (
            <BreakdownBarRow
              key={row.sport}
              label={sportLabels[row.sport] ?? row.sport}
              value={formatRowValue(row, metric, distanceUnit)}
              pct={breakdownBarPct(breakdownValue(row, metric), max)}
              isSelected={isSelected}
              dimmed={selectedSports.length > 0 && !isSelected}
              onClick={() => onToggleSport(row.sport)}
              barColor={sportColors[row.sport] ?? DEFAULT_SPORT_COLOR}
            />
          );
        })}
      </ul>
    </InsightSection>
  );
}
