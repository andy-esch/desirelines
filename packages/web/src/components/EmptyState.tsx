import { Link } from "@tanstack/react-router";
import type { MetricUnit } from "../utils/units";
import { DEMO_ROUTE_PREFIX } from "../constants/demoConfig";
import { usePublicSportConfig } from "../hooks/usePublicSportConfig";
import { getSportDisplayName } from "../utils/sportConfig";

interface EmptyStateProps {
  sport?: string | undefined;
  year?: number | undefined;
  message?: string | undefined;
  unit?: MetricUnit | undefined;
  /** If provided, shows a link to view data from a different year */
  suggestedYear?: number | undefined;
  /** Route prefix for links (e.g., "/demo" for demo mode) */
  linkPrefix?: string | undefined;
}

/**
 * Empty state for when there's no data to display: a "No data available" headline in the
 * theme's accents, glowing as its page titles do, with optional context about the sport and
 * year. The accents are role colors, so the headline stays legible on a light ground.
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
  const { sportConfig } = usePublicSportConfig();
  const defaultMessage =
    sport && year
      ? `No ${getSportDisplayName(sport, sportConfig)} ${unit === "sessions" ? "sessions" : "activities"} recorded for ${year}`
      : "No data available";

  const isDemo = linkPrefix === DEMO_ROUTE_PREFIX;
  const yearStr = suggestedYear ? String(suggestedYear) : "";

  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] md:min-h-[300px] p-4 md:p-8">
      <div className="text-2xl sm:text-[2rem] md:text-[2.5rem] font-bold mb-4 text-center [text-shadow:0_0_var(--page-title-glow-size)_color-mix(in_srgb,currentColor_60%,transparent)]">
        <span className="text-accent-magenta">No</span>{" "}
        <span className="text-accent-cyan">data</span>{" "}
        <span className="text-success">available</span>
      </div>
      <p className="text-muted-text text-sm md:text-base text-center m-0">
        {message || defaultMessage}
      </p>
      {suggestedYear && sport && (
        <p className="text-muted-text text-sm md:text-base text-center m-0 mt-2">
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
