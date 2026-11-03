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
import { chartLabelToString } from "../../utils/chartUtils";
import { useThemeDateFormat } from "../theme/useThemeDateFormat";
import RouteChartTooltip from "./RouteChartTooltip";
import { InsightSection } from "./InsightSection";

export interface CumulativeDistanceChartProps {
  activities: MapActivity[];
  distanceUnit: DistanceUnit;
}

/**
 * Cumulative distance — running total over the filtered set, by day (recharts
 * line, neon accent). Reflects the cross-filter in lockstep.
 */
export default function CumulativeDistanceChart({
  activities,
  distanceUnit,
}: CumulativeDistanceChartProps) {
  const { formatActivityDate } = useThemeDateFormat();
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
    <InsightSection
      title="Cumulative distance"
      ariaLabel="Cumulative distance"
      isEmpty={data.length === 0}
    >
      <div className="h-36" aria-hidden="true">
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
              content={
                <RouteChartTooltip
                  name="Total"
                  formatLabel={(d) => formatActivityDate(chartLabelToString(d), { year: true })}
                  formatValue={(v) => `${Math.round(v).toLocaleString()} ${unit}`}
                />
              }
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
      {/* Text alternative for the visual-only chart (the SVG line is aria-hidden). */}
      <table className="sr-only">
        <caption>Cumulative distance ({unit}) by date</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Total ({unit})</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{formatActivityDate(d.date, { year: true })}</td>
              <td>{Math.round(d.total).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </InsightSection>
  );
}
