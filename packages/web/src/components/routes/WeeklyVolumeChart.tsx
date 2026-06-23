import { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import type { MapActivity } from "../../api/map";
import { convertDistance, getDistanceLabel, type DistanceUnit } from "../../utils/units";
import { weeklyVolume } from "../../utils/mapInsights";
import { formatActivityDate } from "../../utils/formatActivityDate";

type WeeklyMetric = "distance" | "time";

export interface WeeklyVolumeChartProps {
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
 * Weekly volume — distance or moving-time per ISO week over the filtered set
 * (recharts bars, themed/neon-accent). Cross-filters in lockstep via the shared
 * `filteredActivities`.
 */
export default function WeeklyVolumeChart({ activities, distanceUnit }: WeeklyVolumeChartProps) {
  const [metric, setMetric] = useState<WeeklyMetric>("distance");
  const unit = metric === "distance" ? getDistanceLabel(distanceUnit) : "h";
  const data = useMemo(
    () =>
      weeklyVolume(activities).map((w) => ({
        week: w.weekStart,
        value:
          metric === "distance"
            ? convertDistance(w.distanceMeters, distanceUnit)
            : w.movingTimeSeconds / 3600,
      })),
    [activities, metric, distanceUnit]
  );

  return (
    <section className="px-4 py-3" aria-label="Weekly volume">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-light">
          Weekly volume
        </p>
        <ToggleGroup
          value={[metric]}
          onValueChange={(vals) => {
            const v = vals[0] as WeeklyMetric | undefined;
            if (v) setMetric(v);
          }}
          aria-label="Weekly metric"
          className="p-0.5 text-xs"
        >
          <ToggleGroupItem value="distance" className="px-2 py-0.5">
            Distance
          </ToggleGroupItem>
          <ToggleGroupItem value="time" className="px-2 py-0.5">
            Time
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {data.length === 0 ? (
        <p className="text-xs text-slate-light">No activities to summarize.</p>
      ) : (
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
                tickFormatter={(d) => formatActivityDate(String(d))}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                width={40}
                tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => String(Math.round(v))}
              />
              <Tooltip
                cursor={{ fill: "rgba(120,120,120,0.15)" }}
                contentStyle={TOOLTIP_STYLE}
                formatter={(v) => [`${Math.round(Number(v))} ${unit}`, "Volume"]}
                labelFormatter={(d) => `Week of ${formatActivityDate(String(d), { year: true })}`}
              />
              <Bar dataKey="value" fill="var(--color-accent-cyan)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
