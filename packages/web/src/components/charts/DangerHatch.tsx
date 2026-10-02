/**
 * DangerHatch - The danger zone's stripes, as an SVG pattern the zone and its legend swatch
 * both fill with, so the swatch looks like the zone it names.
 */
import { useId } from "react";
import { DANGER_ZONE_CONFIG } from "../../constants/chartConfig";

/**
 * A pattern id unique to this element: two pacing charts on a page would otherwise share one
 * id, and the second would paint with the first chart's stripes.
 */
export function useDangerHatchId(): string {
  return `danger-hatch-${useId().replace(/:/g, "")}`;
}

/** 2px stripes every 8px at 45 degrees, the weight the retro designs call for. */
export function DangerHatch({ id }: { id: string }) {
  const { stripe, stripeOpacity } = DANGER_ZONE_CONFIG.area;
  return (
    <pattern
      id={id}
      width={8}
      height={8}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <rect width={2} height={8} fill={stripe} fillOpacity={stripeOpacity} />
    </pattern>
  );
}
