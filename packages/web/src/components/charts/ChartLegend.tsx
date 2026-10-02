/**
 * ChartLegend - The row above a line chart that names its lines. A line's entry comes from the
 * same description the chart draws the line from (`legendItem` in chartLines.ts), so its
 * swatch has the line's stroke, width and dash; the danger zone's has the zone's hatch. The
 * text takes the theme's legend size and tracking.
 */
import { DANGER_ZONE_CONFIG } from "../../constants/chartConfig";
import { DangerHatch, useDangerHatchId } from "./DangerHatch";

/** A line's stroke as the chart draws it, or the danger zone's hatched area. */
export type LegendSwatch =
  { stroke: string; width: number; dash?: string | undefined } | "danger-zone";

export interface LegendItem {
  label: string;
  swatch: LegendSwatch;
}

const SWATCH_WIDTH = 18;
const SWATCH_HEIGHT = 10;

function DangerZoneSwatch() {
  const hatchId = useDangerHatchId();
  const { line } = DANGER_ZONE_CONFIG;
  return (
    <>
      <defs>
        <DangerHatch id={hatchId} />
      </defs>
      <rect width={SWATCH_WIDTH} height={SWATCH_HEIGHT} fill={`url(#${hatchId})`} />
      {/* The threshold line along the zone's edge */}
      <line
        x2={SWATCH_WIDTH}
        y1={1}
        y2={1}
        stroke={line.stroke}
        strokeWidth={line.strokeWidth}
        strokeDasharray={line.strokeDasharray}
      />
    </>
  );
}

function Swatch({ swatch }: { swatch: LegendSwatch }) {
  return (
    <svg
      width={SWATCH_WIDTH}
      height={SWATCH_HEIGHT}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      {swatch === "danger-zone" ? (
        <DangerZoneSwatch />
      ) : (
        <line
          x2={SWATCH_WIDTH}
          y1={SWATCH_HEIGHT / 2}
          y2={SWATCH_HEIGHT / 2}
          stroke={swatch.stroke}
          strokeWidth={swatch.width}
          strokeDasharray={swatch.dash}
        />
      )}
    </svg>
  );
}

export default function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul
      aria-label="Legend"
      className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-(length:--chart-legend-size) tracking-(--chart-legend-tracking) uppercase text-subtle-text"
    >
      {items.map((item, index) => (
        <li key={`${index}-${item.label}`} className="flex items-center gap-2">
          <Swatch swatch={item.swatch} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
