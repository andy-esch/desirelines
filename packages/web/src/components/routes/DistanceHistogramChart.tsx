import { useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { MapActivity } from "../../api/map";
import { convertDistance, getDistanceLabel, type DistanceUnit } from "../../utils/units";
import { distanceHistogram } from "../../utils/mapInsights";

export interface DistanceHistogramChartProps {
  activities: MapActivity[];
  distanceUnit: DistanceUnit;
  /** Click a bin → set the distance filter to that range (cross-filter). */
  onSelectRange: (range: [number, number]) => void;
}

const TOOLTIP_STYLE = {
  background: "var(--color-chart-tooltip-bg)",
  border: "1px solid var(--color-chart-tooltip-border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--color-chart-tooltip-text)",
} as const;

/**
 * Distance histogram — activity counts per distance bin over the filtered set
 * (recharts bars). Pairs with the distance filter: clicking a bar sets the
 * distance range to that bin.
 */
export default function DistanceHistogramChart({
  activities,
  distanceUnit,
  onSelectRange,
}: DistanceHistogramChartProps) {
  const unit = getDistanceLabel(distanceUnit);
  const data = useMemo(
    () =>
      distanceHistogram(activities).map((b) => ({
        label: `${Math.round(convertDistance(b.start, distanceUnit))}`,
        count: b.count,
        start: b.start,
        end: b.end,
      })),
    [activities, distanceUnit]
  );

  return (
    <section className="px-4 py-3" aria-label="Distance histogram">
      <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-light">
        Distance ({unit})
      </p>
      {data.length === 0 ? (
        <p className="text-xs text-slate-light">No activities to summarize.</p>
      ) : (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                width={28}
                allowDecimals={false}
                tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(120,120,120,0.15)" }}
                contentStyle={TOOLTIP_STYLE}
                formatter={(v) => [`${Number(v)} activities`, "Count"]}
                labelFormatter={(l) => `${l}+ ${unit}`}
              />
              <Bar
                dataKey="count"
                fill="var(--color-accent-cyan)"
                radius={[2, 2, 0, 0]}
                cursor="pointer"
                onClick={(d) => {
                  const bin = d as unknown as Record<string, unknown>;
                  if (typeof bin.start === "number" && typeof bin.end === "number") {
                    onSelectRange([bin.start, bin.end]);
                  }
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
