import { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { MapActivity } from "../../api/map";
import { convertDistance, getDistanceLabel, type DistanceUnit } from "../../utils/units";
import { weeklyVolume } from "../../utils/mapInsights";
import { chartLabelToString } from "../../utils/chartUtils";
import { useThemeDateFormat } from "../theme/useThemeDateFormat";
import RouteChartTooltip from "./RouteChartTooltip";
import { InsightSection } from "./InsightSection";
import { MetricToggle, type MetricOption } from "./MetricToggle";

type WeeklyMetric = "distance" | "time";

export interface WeeklyVolumeChartProps {
  activities: MapActivity[];
  distanceUnit: DistanceUnit;
}

const WEEKLY_METRICS: readonly MetricOption<WeeklyMetric>[] = [
  { value: "distance", label: "Distance" },
  { value: "time", label: "Time" },
];

/**
 * Weekly volume — distance or moving-time per ISO week over the filtered set
 * (recharts bars, themed/neon-accent). Cross-filters in lockstep via the shared
 * `filteredActivities`.
 */
export default function WeeklyVolumeChart({ activities, distanceUnit }: WeeklyVolumeChartProps) {
  const { formatActivityDate } = useThemeDateFormat();
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
    <InsightSection
      title="Weekly volume"
      ariaLabel="Weekly volume"
      isEmpty={data.length === 0}
      action={
        <MetricToggle
          options={WEEKLY_METRICS}
          value={metric}
          onChange={setMetric}
          ariaLabel="Weekly metric"
        />
      }
    >
      <div className="h-36" aria-hidden="true">
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
              cursor={{ fill: "var(--chart-hover-column)" }}
              content={
                <RouteChartTooltip
                  name="Volume"
                  formatLabel={(d) =>
                    `Week of ${formatActivityDate(chartLabelToString(d), { year: true })}`
                  }
                  formatValue={(v) => `${Math.round(v)} ${unit}`}
                />
              }
            />
            <Bar
              dataKey="value"
              fill="var(--color-accent-cyan)"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Text alternative for the visual-only chart (the SVG bars are aria-hidden). */}
      <table className="sr-only">
        <caption>Weekly {metric === "distance" ? "distance" : "time"} by week</caption>
        <thead>
          <tr>
            <th>Week of</th>
            <th>{metric === "distance" ? `Distance (${unit})` : "Time (hours)"}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.week}>
              <td>{formatActivityDate(d.week, { year: true })}</td>
              <td>{d.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </InsightSection>
  );
}
