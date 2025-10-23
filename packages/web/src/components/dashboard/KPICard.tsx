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
      <div
        className="card h-100"
        style={{
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
          cursor: "default",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-4px)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "";
        }}
      >
        <div className="card-body d-flex flex-column justify-content-between py-3">
          <h6 className="card-subtitle mb-2 text-muted small">{title}</h6>
          <div>
            <h2 className="card-title mb-1">{value}</h2>
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
