import type { ReactNode } from "react";
import { Stat } from "../theme/Stat";

export interface KPICardProps {
  /** Card title displayed at the top */
  title: string;
  /** Main value displayed prominently */
  value: ReactNode;
  /** Additional context displayed below the value */
  subtitle: string | ReactNode;
  /** Optional indicator (e.g., momentum arrow) shown after subtitle */
  indicator?: ReactNode;
}

/**
 * A single KPI (Key Performance Indicator) card with hover effects
 *
 * Displays a metric with title, value, and subtitle as a theme `Stat`, which frames it
 * per the theme.
 *
 * @example
 * <KPICard
 *   title="Current Distance"
 *   value="2450 miles"
 *   subtitle="8.3 miles / day avg · 295 days elapsed"
 *   indicator={<MomentumIndicator />}
 * />
 */
export default function KPICard({ title, value, subtitle, indicator }: KPICardProps) {
  return (
    <Stat
      label={title}
      value={value}
      sub={
        <>
          {subtitle}
          {indicator}
        </>
      }
    />
  );
}
