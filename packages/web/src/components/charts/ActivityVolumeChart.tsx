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
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SportConfig } from "../../api/activities";
import type { ChartData } from "../../utils/activityBuckets";
import { CHART_CONFIG } from "../../constants/chartConfig";
import { SPORT_COLORS, DEFAULT_SPORT_COLOR, getSportDisplayName } from "../../utils/sportConfig";

function sportColor(sport: string): string {
  return SPORT_COLORS[sport] ?? DEFAULT_SPORT_COLOR;
}

/** "2026-05" → "May" (or "May '26" when the range spans multiple years). */
function formatMonthLabel(month: string, showYear: boolean): string {
  // Fixed offsets into "YYYY-MM" rather than destructuring split(), whose
  // elements type as possibly-undefined and previously needed a `!`.
  const year = month.slice(0, 4);
  const name = new Date(Number(year), Number(month.slice(5, 7)) - 1, 1).toLocaleString("en-US", {
    month: "short",
  });
  return showYear ? `${name} '${year.slice(2)}` : name;
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
  const { rows, series } = data;

  const showYear = useMemo(() => new Set(rows.map((r) => r.month.slice(0, 4))).size > 1, [rows]);

  return (
    <div>
      <ResponsiveContainer width="100%" height={CHART_CONFIG.height}>
        <BarChart data={rows} margin={CHART_CONFIG.margin}>
          <CartesianGrid stroke={CHART_CONFIG.grid.stroke} vertical={CHART_CONFIG.grid.vertical} />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => formatMonthLabel(m, showYear)}
            stroke={CHART_CONFIG.axis.stroke}
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
              style: {
                fill: CHART_CONFIG.tick.fill,
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
            cursor={{ fill: "var(--color-chart-grid)", opacity: 0.25 }}
            content={
              <VolumeTooltip
                series={series}
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
              // Thin ring around each stacked fill, doing two jobs at once. Dark: it
              // resolves to the page ground and just separates segments. Light: it goes
              // to ink, giving the neon fill a boundary that clears 3:1 against
              // #f0f4f8 — which --color-bg-body could not do, being light there.
              stroke="var(--color-chart-mark-outline)"
              strokeWidth={1}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-light">
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
 * `--color-chart-tooltip-*` tokens (same as ChartTooltip) so text/surface contrast
 * is correct in both light and dark themes — plain body-text on a fixed surface
 * inverted in light mode, which is what read as black-on-dark.
 */
let _seriesIndexFor: ChartData["series"] | null = null;
let _seriesIndexCache = new Map<string, ChartData["series"][number]>();

/** Cached `key -> series` lookup, rebuilt only when the series array changes. */
function seriesIndex(series: ChartData["series"]) {
  if (_seriesIndexFor !== series) {
    _seriesIndexFor = series;
    _seriesIndexCache = new Map(series.map((s) => [s.key, s]));
  }
  return _seriesIndexCache;
}

function VolumeTooltip({
  active,
  label,
  payload,
  series,
  sportConfig,
  formatValue,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayloadEntry[];
  series: ChartData["series"];
  sportConfig: SportConfig | null;
  formatValue: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0 || typeof label !== "string") return null;

  // `series` is stable across a hover gesture but this component re-renders on
  // every frame of it, so the lookup map is built once per series list rather
  // than once per frame.
  const byKey = seriesIndex(series);
  // flatMap rather than map+filter so `meta` narrows to non-null for the
  // consumers below; a boolean .filter() does not narrow, which is what forced
  // the `r.meta!` assertions at each use site.
  const rows = payload
    .flatMap((p) => {
      const meta = byKey.get(p.dataKey);
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
        borderRadius: "0.625rem",
        padding: "10px 12px",
        boxShadow: "0 2px 12px var(--color-surface-shadow)",
        fontFamily: '"Space Grotesk", sans-serif',
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
        {formatMonthLabel(label, true)}
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
