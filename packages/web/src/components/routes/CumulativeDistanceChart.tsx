import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { MapActivity } from "../../api/map";
import { convertDistance, getDistanceLabel, type DistanceUnit } from "../../utils/units";
import { cumulativeDistance } from "../../utils/mapInsights";
import { formatActivityDate } from "../../utils/formatActivityDate";

export interface CumulativeDistanceChartProps {
  activities: MapActivity[];
  distanceUnit: DistanceUnit;
}

const TOOLTIP_STYLE = {
  background: "var(--color-chart-tooltip-bg)",
  border: "1px solid var(--color-chart-tooltip-border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--color-chart-tooltip-text)",
} as const;

/**
 * Cumulative distance — running total over the filtered set, by day (recharts
 * line, neon accent). Reflects the cross-filter in lockstep.
 */
export default function CumulativeDistanceChart({
  activities,
  distanceUnit,
}: CumulativeDistanceChartProps) {
  const unit = getDistanceLabel(distanceUnit);
  const data = useMemo(
    () =>
      cumulativeDistance(activities).map((p) => ({
        date: p.date,
        total: convertDistance(p.cumulativeMeters, distanceUnit),
      })),
    [activities, distanceUnit]
  );

  return (
    <section className="px-4 py-3" aria-label="Cumulative distance">
      <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-light">
        Cumulative distance
      </p>
      {data.length === 0 ? (
        <p className="text-xs text-slate-light">No activities to summarize.</p>
      ) : (
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
                tickFormatter={(d) => formatActivityDate(String(d))}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                width={40}
                tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => String(Math.round(v))}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v) => [`${Math.round(Number(v)).toLocaleString()} ${unit}`, "Total"]}
                labelFormatter={(d) => formatActivityDate(String(d), { year: true })}
              />
              <Line
                type="monotone"
                dataKey="total"
                stroke="var(--color-accent-cyan)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
