import { Link } from "@tanstack/react-router";
import type { MetricUnit } from "../utils/units";

interface EmptyStateProps {
  sport?: string;
  year?: number;
  message?: string;
  unit?: MetricUnit;
  /** If provided, shows a link to view data from a different year */
  suggestedYear?: number;
  /** Route prefix for links (e.g., "/demo" for demo mode) */
  linkPrefix?: string;
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
export function EmptyState({
  sport,
  year,
  message,
  unit,
  suggestedYear,
  linkPrefix = "",
}: EmptyStateProps) {
  const defaultMessage =
    sport && year
      ? `No ${sport} ${unit === "sessions" ? "sessions" : "activities"} recorded for ${year}`
      : "No data available";

  const isDemo = linkPrefix === "/demo";
  const yearStr = suggestedYear ? String(suggestedYear) : "";

  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] md:min-h-[300px] p-4 md:p-8 neon-backdrop">
      <div className="text-2xl sm:text-[2rem] md:text-[2.5rem] font-bold mb-4 text-center">
        <span className="neon-glow-pink">No</span> <span className="neon-glow-cyan">data</span>{" "}
        <span className="neon-glow-green">available</span>
      </div>
      <p className="text-slate-light text-sm md:text-base text-center m-0">
        {message || defaultMessage}
      </p>
      {suggestedYear && sport && (
        <p className="text-slate-light text-sm md:text-base text-center m-0 mt-2">
          {isDemo ? (
            <Link
              to="/demo/$sport/$year"
              params={{ sport, year: yearStr }}
              className="text-accent-cyan"
            >
              View {suggestedYear} instead →
            </Link>
          ) : (
            <Link to="/$sport/$year" params={{ sport, year: yearStr }} className="text-accent-cyan">
              View {suggestedYear} instead →
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

export default EmptyState;
