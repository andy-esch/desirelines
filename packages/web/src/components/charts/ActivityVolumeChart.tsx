/**
 * ActivityVolumeChart — pure presenter for the Charts view.
 *
 * Stacked monthly bars over the filtered activity set, stacked by sport using the
 * app's established sport colors (matching the map + dashboard). Which activities
 * are included (all / outdoor / indoor) is a filter applied upstream, not a visual
 * encoding — so the bars are plain solid sport segments and the chart stays a
 * single clean job: activity volume by sport over time.
 *
 * Pure: all data-shaping, filtering, and unit choices happen upstream.
 */
import { useMemo } from "react";
import { useThemeDateFormat } from "../theme/useThemeDateFormat";
import { useThemeTokenValue } from "../theme/useThemeTokenValue";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";
import type { SportConfig } from "../../api/activities";
import type { ChartData, ChartRow } from "../../utils/activityBuckets";
import { CHART_CONFIG } from "../../constants/chartConfig";
import { SPORT_COLORS, DEFAULT_SPORT_COLOR, getSportDisplayName } from "../../utils/sportConfig";

function sportColor(sport: string): string {
  return SPORT_COLORS[sport] ?? DEFAULT_SPORT_COLOR;
}

/**
 * The series on top of a month's stack: the last one, in stacking order, with any volume.
 * Only that segment takes the theme's bar radius, so a stack is rounded once at its top
 * rather than at every sport.
 */
export function topOfStack(row: ChartRow, series: ChartData["series"]): string | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const value = row[series[i]!.key];
    if (typeof value === "number" && value > 0) return series[i]!.key;
  }
  return undefined;
}

interface ActivityVolumeChartProps {
  data: ChartData;
  sportConfig: SportConfig | null;
  /** Compact value formatter for axis ticks (unit lives in the axis label). */
  formatAxisValue: (value: number) => string;
  /** Value formatter for the tooltip, including the unit. */
  formatTooltipValue: (value: number) => string;
  /** Y-axis label for the active metric, e.g. "Distance (mi)". */
  metricLabel: string;
  /** Allow fractional Y ticks — true for continuous measures, false for counts. */
  allowDecimals: boolean;
}

export default function ActivityVolumeChart({
  data,
  sportConfig,
  formatAxisValue,
  formatTooltipValue,
  metricLabel,
  allowDecimals,
}: ActivityVolumeChartProps) {
  const { formatMonth } = useThemeDateFormat();
  const { rows, series } = data;

  const showYear = useMemo(() => new Set(rows.map((r) => r.month.slice(0, 4))).size > 1, [rows]);
  // Built once per series list: the tooltip re-renders on every frame of a hover.
  const seriesByKey = useMemo(() => new Map(series.map((s) => [s.key, s])), [series]);
  const topSeries = useMemo(
    () => new Map(rows.map((r) => [r.month, topOfStack(r, series)])),
    [rows, series]
  );
  const [chartRef, barRadiusValue] = useThemeTokenValue<HTMLDivElement>("--chart-bar-radius", "0");
  const barRadius = parseFloat(barRadiusValue) || 0;

  return (
    <div ref={chartRef}>
      <ResponsiveContainer width="100%" height={CHART_CONFIG.height}>
        <BarChart data={rows} margin={CHART_CONFIG.margin}>
          <CartesianGrid stroke={CHART_CONFIG.grid.stroke} vertical={CHART_CONFIG.grid.vertical} />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => formatMonth(m, showYear)}
            stroke={CHART_CONFIG.baseline.stroke}
            tick={CHART_CONFIG.tick}
          />
          <YAxis
            tickFormatter={formatAxisValue}
            stroke={CHART_CONFIG.axis.stroke}
            tick={CHART_CONFIG.tick}
            width={84}
            // allowDecimals is metric-driven: fractional ticks (0.5 hr, 2.5 mi) are
            // right for continuous measures, but a countable one (sessions) must stay
            // integer or a single-session month rounds to [0,0,0,1,1]. The domain
            // floor of 1 keeps an all-zero metric from collapsing to [0,0,0,0,0].
            allowDecimals={allowDecimals}
            domain={[0, (dataMax: number) => (dataMax <= 0 ? 1 : dataMax)]}
            label={{
              value: metricLabel,
              angle: -90,
              position: "insideLeft",
              // `fill` sits beside `style`, not inside it — the convention the
              // two presenters already use. Keep the three in step.
              fill: CHART_CONFIG.tick.fill,
              style: {
                fontFamily: CHART_CONFIG.tick.fontFamily,
                fontSize: 12,
                textAnchor: "middle",
              },
            }}
          />
          <Tooltip
            // Off by default recharts slides the box between categories (reads as a
            // "snap"); disable the position tween and nudge it off the hovered bar.
            isAnimationActive={false}
            offset={16}
            cursor={{ fill: "var(--chart-hover-column)" }}
            content={
              <VolumeTooltip
                seriesByKey={seriesByKey}
                sportConfig={sportConfig}
                formatValue={formatTooltipValue}
              />
            }
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="volume"
              fill={sportColor(s.sport)}
              // Ring around each stacked fill, doing two jobs at once. Dark: it resolves
              // to the panel ground, so its width is the gap between sports. Light: it goes
              // to ink, giving the neon fill a boundary that clears 3:1 against
              // #f0f4f8 — which --color-bg-body could not do, being light there.
              stroke="var(--color-chart-mark-outline)"
              strokeWidth="var(--chart-bar-gap)"
              isAnimationActive={false}
              shape={(bar: BarShapeProps) => (
                <Rectangle
                  {...bar}
                  radius={
                    topSeries.get((bar.payload as ChartRow).month) === s.key
                      ? [barRadius, barRadius, 0, 0]
                      : 0
                  }
                />
              )}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-text">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              // Same outline as the bars: invisible against the dark ground, an ink
              // boundary in light mode so a 10px neon square is still a legible mark.
              className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-chart-mark-outline"
              style={{ backgroundColor: sportColor(s.sport) }}
            />
            {getSportDisplayName(s.sport, sportConfig)}
          </span>
        ))}
      </div>
    </div>
  );
}

interface TooltipPayloadEntry {
  dataKey: string;
  value: number;
}

/**
 * Custom tooltip: month header, per-sport rows, total. Uses the shared
 * `--color-chart-tooltip-*` tokens (same as ChartTooltip), so its text and surface
 * follow the theme together; plain body text on a fixed surface is what once read as
 * black-on-dark in a light theme.
 */
function VolumeTooltip({
  active,
  label,
  payload,
  seriesByKey,
  sportConfig,
  formatValue,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayloadEntry[];
  seriesByKey: ReadonlyMap<string, ChartData["series"][number]>;
  sportConfig: SportConfig | null;
  formatValue: (value: number) => string;
}) {
  const { formatMonth } = useThemeDateFormat();
  if (!active || !payload || payload.length === 0 || typeof label !== "string") return null;

  // flatMap rather than map+filter so `meta` narrows to non-null for the
  // consumers below; a boolean .filter() does not narrow, which is what forced
  // the `r.meta!` assertions at each use site.
  const rows = payload
    .flatMap((p) => {
      const meta = seriesByKey.get(p.dataKey);
      return meta && p.value > 0 ? [{ meta, value: p.value }] : [];
    })
    .reverse(); // top-of-stack first, matching visual order
  if (rows.length === 0) return null;

  const total = rows.reduce((n, r) => n + r.value, 0);

  return (
    <div
      style={{
        backgroundColor: "var(--color-chart-tooltip-bg)",
        border: "1px solid var(--color-chart-tooltip-border)",
        borderRadius: "var(--tooltip-radius)",
        padding: "10px 12px",
        boxShadow: "0 2px 12px var(--color-surface-shadow)",
        fontFamily: "var(--font-chart)",
        fontSize: "12px",
        minWidth: "160px",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: "var(--color-chart-tooltip-text)",
          marginBottom: "8px",
          paddingBottom: "6px",
          borderBottom: "1px solid var(--color-chart-tooltip-divider)",
        }}
      >
        {formatMonth(label, true)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {rows.map((r) => (
          <div
            key={r.meta.key}
            style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "2px",
                backgroundColor: sportColor(r.meta.sport),
                // Same outline as the bars and legend. This one earns its keep on the
                // near-white light tooltip, where an 8px neon square is ~1.3:1; in dark
                // it's a faint hairline against the tooltip fill rather than invisible,
                // which is the intended cost of keeping one token for all sport marks.
                boxShadow: "0 0 0 1px var(--color-chart-mark-outline)",
                flexShrink: 0,
              }}
            />
            <span style={{ color: "var(--color-chart-tooltip-label)" }}>
              {getSportDisplayName(r.meta.sport, sportConfig)}
            </span>
            <span
              style={{
                color: "var(--color-chart-tooltip-text)",
                fontWeight: 500,
                marginLeft: "auto",
              }}
              className="tabular-nums"
            >
              {formatValue(r.value)}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: "6px",
          paddingTop: "6px",
          borderTop: "1px solid var(--color-chart-tooltip-divider)",
          display: "flex",
          justifyContent: "space-between",
          gap: "8px",
          fontWeight: 600,
          color: "var(--color-chart-tooltip-text)",
        }}
      >
        <span>Total</span>
        <span className="tabular-nums">{formatValue(total)}</span>
      </div>
    </div>
  );
}
