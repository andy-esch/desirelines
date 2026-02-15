import React from "react";

export interface KPICardProps {
  /** Card title displayed at the top */
  title: string;
  /** Main value displayed prominently */
  value: React.ReactNode;
  /** Additional context displayed below the value */
  subtitle: string | React.ReactNode;
  /** Optional indicator (e.g., momentum arrow) shown after subtitle */
  indicator?: React.ReactNode;
}

/**
 * A single KPI (Key Performance Indicator) card with hover effects
 *
 * Displays a metric with title, value, and subtitle in a Bootstrap card.
 * Includes smooth hover animations for visual feedback.
 *
 * @example
 * <KPICard
 *   title="Current Distance"
 *   value="2450 mi"
 *   subtitle="8.3 mi/day avg · 295 days"
 *   indicator={<MomentumIndicator />}
 * />
 */
const KPICard = React.memo(({ title, value, subtitle, indicator }: KPICardProps) => {
  return (
    <div className="glass-panel-kpi h-full">
      <div className="flex flex-col justify-between p-3 md:p-4">
        <h6 className="mb-1 text-slate-light text-sm">{title}</h6>
        <div>
          <div className="kpi-value mb-1">{value}</div>
          <small className="text-slate-light">
            {subtitle}
            {indicator}
          </small>
        </div>
      </div>
    </div>
  );
});

KPICard.displayName = "KPICard";

export default KPICard;
