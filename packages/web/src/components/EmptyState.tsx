import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
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
  /** A way out of the empty state, e.g. a button that clears the filters. */
  action?: ReactNode | undefined;
}

/** "No Cycling activities recorded for 2026": the sport's display name needs the sport config. */
function SportYearMessage({
  sport,
  year,
  unit,
}: {
  sport: string;
  year: number;
  unit?: MetricUnit | undefined;
}) {
  const { sportConfig } = usePublicSportConfig();
  const name = getSportDisplayName(sport, sportConfig);
  return `No ${name} ${unit === "sessions" ? "sessions" : "activities"} recorded for ${year}`;
}

/**
 * Empty state for when there's no data to display: a "No signal" headline in the theme's
 * display face, case and accents, glowing as its page titles do, over the specific line
 * (the sport and year, or the caller's message). The words are the same in every theme. The
 * accents are role colors, so the headline stays legible on a light ground.
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
  action,
}: EmptyStateProps) {
  const isDemo = linkPrefix === DEMO_ROUTE_PREFIX;
  const yearStr = suggestedYear ? String(suggestedYear) : "";

  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] md:min-h-[300px] p-4 md:p-8">
      <p className="m-0 mb-4 text-center font-display font-(weight:--display-weight) text-2xl sm:text-[2rem] md:text-[2.5rem] [text-transform:var(--page-title-case)] [text-shadow:0_0_var(--page-title-glow-size)_color-mix(in_srgb,currentColor_60%,transparent)]">
        <span className="text-accent-magenta">No</span>{" "}
        <span className="text-accent-cyan">signal</span>
      </p>
      <p className="text-muted-text text-sm md:text-base text-center m-0">
        {message ||
          (sport && year ? <SportYearMessage {...{ sport, year, unit }} /> : "No data available")}
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
      {action != null && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default EmptyState;
