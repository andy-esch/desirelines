import { Link } from "react-router-dom";
import type { MetricUnit } from "../utils/units";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  sport?: string;
  year?: number;
  message?: string;
  unit?: MetricUnit;
  /** If provided, shows a link to view data from a different year */
  suggestedYear?: number;
}

/**
 * NEON-themed empty state component for when there's no data to display
 *
 * Displays a visually appealing "No data available" message with NEON glow effects
 * and optional context about the sport/year.
 *
 * @example
 * <EmptyState sport="yoga" year={2023} />
 * <EmptyState message="No chart data available" />
 * <EmptyState sport="cycling" year={2026} suggestedYear={2025} />
 */
export function EmptyState({ sport, year, message, unit, suggestedYear }: EmptyStateProps) {
  const defaultMessage =
    sport && year
      ? `No ${sport} ${unit === "sessions" ? "sessions" : "activities"} recorded for ${year}`
      : "No data available";

  return (
    <div className={styles["empty-state-container"]}>
      <div className={styles["neon-text"]}>
        <span className={styles["neon-pink"]}>No</span>{" "}
        <span className={styles["neon-cyan"]}>data</span>{" "}
        <span className={styles["neon-green"]}>available</span>
      </div>
      <p className={styles["empty-state-subtitle"]}>{message || defaultMessage}</p>
      {suggestedYear && sport && (
        <p className={styles["empty-state-subtitle"]} style={{ marginTop: "0.5rem" }}>
          <Link to={`/${sport}/${suggestedYear}`} style={{ color: "var(--accent-cyan, #00d4ff)" }}>
            View {suggestedYear} instead →
          </Link>
        </p>
      )}
    </div>
  );
}

export default EmptyState;
