import React from "react";

export interface KPICardProps {
  /** Card title displayed at the top */
  title: string;
  /** Main value displayed prominently */
  value: string | number;
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
    <div className="col-md-4">
      <div className="glass-panel-kpi h-100">
        <div className="d-flex flex-column justify-content-between p-2">
          <h6 className="mb-2 text-muted small">{title}</h6>
          <div>
            <h2 className="mb-1">{value}</h2>
            <small className="text-muted">
              {subtitle}
              {indicator}
            </small>
          </div>
        </div>
      </div>
    </div>
  );
});

KPICard.displayName = "KPICard";

export default KPICard;
