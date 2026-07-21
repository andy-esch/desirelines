import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useActivities } from "../../hooks/useActivities";
import { useAuth } from "../../hooks/useAuth";
import { useDashboardGoalData } from "../../hooks/useDashboardGoalData";
import type { SportGoalData } from "../../hooks/useDashboardGoalData";
import NeonSpinner from "../NeonSpinner";
import { MapPinIcon } from "../ui/MapPinIcon";
import type { TimeRange } from "../../utils/dataNormalization";
import { convertDistance, formatDistance, formatImpactPct } from "../../utils/units";

import { getTimeRangeCutoff as getCutoff } from "../../utils/chartUtils";
import { parseRgb, resolveThemeColor, type Rgb } from "../../utils/colorTokens";
import { useTheme } from "../../contexts/ThemeContext";
import { toLocalDateString as toLocal } from "../../utils/dateUtils";
import { formatActivityDate } from "../../utils/formatActivityDate";

/** Height of the thead row in px */
const HEADER_HEIGHT = 22;
/** Height of each data row in px */
const ROW_HEIGHT = 28;
/** Minimum rows to show */
const MIN_ROWS = 3;

function getDateRangeFromTimeRange(timeRange: TimeRange): { from: string; to: string } {
  const now = new Date();
  const to = toLocal(now);
  const cutoff = getCutoff(now, timeRange);
  const from = toLocal(cutoff);
  return { from, to };
}

/**
 * Format duration.
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/**
 * Impact glow ramp endpoints, as tokens.
 *
 * The ramp is interpolated numerically in JS, so it can't consume `var(...)` — the
 * values are resolved at render time instead, which is what makes it theme-aware.
 * It previously interpolated from a hard-coded `#718096` and so stayed a dark-theme
 * gray on the light ground. (That literal was labelled "slate-light" but is actually
 * `--color-chart-tick`'s dark value; slate-light is `#778899`. Now genuinely
 * slate-light, the muted-text role this column wants — an imperceptible shift in
 * dark, correct in light.)
 */
const IMPACT_START_TOKEN = "--color-slate-light";
const IMPACT_START_FALLBACK = "#778899";
const IMPACT_END_TOKEN = "--color-neon-magenta";
const IMPACT_END_FALLBACK = "#ff00ff";
/** Impact percentage at which glow reaches full intensity */
const IMPACT_FULL_PCT = 2;
/** Maximum glow radius in px */
const IMPACT_GLOW_RADIUS = 6;
/** Maximum glow opacity */
const IMPACT_GLOW_ALPHA = 0.6;
/** Minimum interpolation value before glow is applied */
const IMPACT_GLOW_THRESHOLD = 0.05;

/**
 * Compute inline styles for the impact percentage column.
 * Interpolates from muted slate (0%) to magenta (2%+) with a glow effect.
 *
 * Endpoints are passed in rather than read here so the resolve happens once per
 * theme in the component, not once per row.
 */
function getImpactStyle(
  pct: number | null,
  startRgb: Rgb,
  endRgb: Rgb
): React.CSSProperties | undefined {
  if (pct == null) return undefined;
  const t = Math.min(Math.max(pct / IMPACT_FULL_PCT, 0), 1);
  const r = Math.round(startRgb.r + (endRgb.r - startRgb.r) * t);
  const g = Math.round(startRgb.g + (endRgb.g - startRgb.g) * t);
  const b = Math.round(startRgb.b + (endRgb.b - startRgb.b) * t);
  const glowRadius = IMPACT_GLOW_RADIUS * t;
  const glowAlpha = IMPACT_GLOW_ALPHA * t;
  return {
    color: `rgb(${r}, ${g}, ${b})`,
    textShadow:
      t > IMPACT_GLOW_THRESHOLD
        ? `0 0 ${glowRadius}px color-mix(in srgb, var(--color-neon-magenta) ${glowAlpha * 100}%, transparent)`
        : undefined,
  };
}

interface RecentActivitiesListProps {
  timeRange: TimeRange;
  pageSize: number;
}

export default function RecentActivitiesList({
  timeRange,
  pageSize: fallbackPageSize,
}: RecentActivitiesListProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  // Re-resolved when the theme flips: resolveThemeColor is a point-in-time read of the
  // DOM, and `resolvedTheme` is the only thing that changes its answer. The linter
  // can't see that — the dependency is real but not lexically referenced, and dropping
  // it would freeze the ramp at whichever theme rendered first.
  const { resolvedTheme } = useTheme();
  const impactRamp = useMemo(
    () => ({
      start: parseRgb(resolveThemeColor(IMPACT_START_TOKEN, IMPACT_START_FALLBACK)) ?? {
        r: 0x77,
        g: 0x88,
        b: 0x99,
      },
      end: parseRgb(resolveThemeColor(IMPACT_END_TOKEN, IMPACT_END_FALLBACK)) ?? {
        r: 0xff,
        g: 0x00,
        b: 0xff,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedTheme]
  );

  // Dynamically measure container height to compute page size
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  const handleResize = useCallback(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight);
    }
  }, []);

  useEffect(() => {
    handleResize();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleResize]);

  const pageSize =
    containerHeight > 0
      ? Math.max(MIN_ROWS, Math.floor((containerHeight - HEADER_HEIGHT) / ROW_HEIGHT))
      : fallbackPageSize;

  // Goal data for impact % column + distance unit preference
  const { sportData, distanceUnit } = useDashboardGoalData();
  const goalLookup = useMemo(() => {
    const lookup: Record<string, SportGoalData> = {};
    for (const g of sportData) {
      lookup[g.sport] = g;
    }
    return lookup;
  }, [sportData]);

  // Reset page when time range changes (adjust state during render, not in an effect)
  const { from, to } = useMemo(() => getDateRangeFromTimeRange(timeRange), [timeRange]);
  const [prevTimeRange, setPrevTimeRange] = useState(timeRange);
  if (timeRange !== prevTimeRange) {
    setPrevTimeRange(timeRange);
    setPage(0);
  }

  const { activities, isLoading, error, hasMore, loadMore } = useActivities({
    from,
    to,
    sports: [],
    limit: 20,
  });

  const totalPages = Math.ceil(activities.length / pageSize);
  // Clamp page if pageSize changed (e.g. container resized) and current page is now out of range
  const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
  if (clampedPage !== page) setPage(clampedPage);
  const startIdx = clampedPage * pageSize;
  const visibleActivities = activities.slice(startIdx, startIdx + pageSize);

  const canGoUp = page > 0;
  const canGoDown = page < totalPages - 1 || hasMore;

  const handleNextPage = () => {
    if (page < totalPages - 1) {
      setPage((p) => p + 1);
    } else if (hasMore) {
      loadMore();
      setPage((p) => p + 1);
    }
  };

  if (isLoading && activities.length === 0) {
    return (
      <div ref={containerRef} className="flex items-center justify-center h-full">
        <NeonSpinner size="sm" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        ref={containerRef}
        className="flex items-center justify-center h-full text-danger"
        style={{ fontSize: "0.8rem" }}
      >
        Failed to load activities
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex items-center justify-center h-full text-slate-light"
        style={{ fontSize: "0.8rem" }}
      >
        No activities in this time range
      </div>
    );
  }

  const showPagination = totalPages > 1 || hasMore;

  return (
    <div ref={containerRef} className="flex h-full">
      {/* Activities table — horizontally scrollable on narrow viewports */}
      <div className="grow" style={{ overflowX: "auto", minWidth: 0 }}>
        <table
          className="table table-sm table-borderless table-dark-transparent mb-0"
          style={{ fontSize: "0.8rem", lineHeight: 1.2, tableLayout: "fixed", minWidth: 420 }}
        >
          <colgroup>
            <col />
            <col style={{ width: 70 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 55 }} />
            <col style={{ width: 58 }} />
          </colgroup>
          <thead>
            <tr style={{ height: HEADER_HEIGHT }}>
              <th
                className="text-left ps-0 pe-2 py-0 text-slate-light font-normal align-middle"
                style={{ fontSize: "0.7rem" }}
              >
                Name
              </th>
              <th
                className="text-left px-1 py-0 text-slate-light font-normal align-middle"
                style={{ fontSize: "0.7rem" }}
              >
                Sport
              </th>
              <th
                className="text-right px-1 py-0 text-slate-light font-normal align-middle"
                style={{ fontSize: "0.7rem" }}
              >
                Goal Impact
              </th>
              <th
                className="text-right px-1 py-0 text-slate-light font-normal align-middle"
                style={{ fontSize: "0.7rem" }}
              >
                Distance
              </th>
              <th
                className="text-right px-1 py-0 text-slate-light font-normal align-middle"
                style={{ fontSize: "0.7rem" }}
              >
                Time
              </th>
              <th
                className="text-right ps-1 pe-0 py-0 text-slate-light font-normal align-middle"
                style={{ fontSize: "0.7rem" }}
              >
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleActivities.map((activity) => {
              const goal = goalLookup[activity.sport];
              let impactPct: number | null = null;
              let impactTooltip = "";
              if (goal?.impactGoal) {
                if (goal.metricType === "distance") {
                  const displayDist = convertDistance(activity.distanceMeters, distanceUnit);
                  impactPct = (displayDist / goal.impactGoal) * 100;
                } else if (goal.metricType === "time") {
                  const activityHours = activity.movingTimeSeconds / 3600;
                  impactPct = (activityHours / goal.impactGoal) * 100;
                } else {
                  impactPct = (1 / goal.impactGoal) * 100;
                }
                const goalLabel = goal.impactGoalLabel ? `${goal.impactGoalLabel} goal` : "goal";
                impactTooltip = `vs. ${Math.round(goal.impactGoal).toLocaleString()} ${goal.metricUnit} ${goalLabel}`;
              }
              return (
                <tr key={activity.id} style={{ height: ROW_HEIGHT }}>
                  <td className="text-left ps-0 pe-2 py-0 align-middle" style={{ maxWidth: 140 }}>
                    {/* Flex so the name truncates while the map-pin stays visible
                        (a pin inside the old ellipsis/overflow-hidden cell got clipped). */}
                    <div className="flex items-center gap-1.5" style={{ minWidth: 0 }}>
                      {user ? (
                        <>
                          <a
                            href={`https://www.strava.com/activities/${activity.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate"
                          >
                            {activity.name}
                          </a>
                          {activity.hasRoute && (
                            <button
                              type="button"
                              onClick={() =>
                                void navigate({
                                  to: "/routes",
                                  search: { activity: Number(activity.id) },
                                })
                              }
                              className="shrink-0 text-slate-light hover:text-accent-cyan motion-safe:transition-colors"
                              title="View on map"
                              aria-label="View this activity on the map"
                            >
                              <MapPinIcon size={12} />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="truncate" title="Links disabled in demo mode">
                          {activity.name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className="text-slate-light text-left px-1 py-0 align-middle"
                    style={{ whiteSpace: "nowrap", textTransform: "capitalize" }}
                  >
                    {activity.sport}
                  </td>
                  <td
                    className={`${impactPct == null ? "text-slate-light " : ""}text-end px-1 py-0 align-middle`}
                    style={{
                      whiteSpace: "nowrap",
                      fontSize: "0.75rem",
                      ...getImpactStyle(impactPct, impactRamp.start, impactRamp.end),
                    }}
                    title={impactTooltip}
                  >
                    {formatImpactPct(impactPct)}
                  </td>
                  <td
                    className="text-slate-light text-right px-1 py-0 align-middle"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {activity.distanceMeters
                      ? formatDistance(activity.distanceMeters, distanceUnit)
                      : ""}
                  </td>
                  <td
                    className="text-slate-light text-right px-1 py-0 align-middle"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {formatDuration(activity.movingTimeSeconds)}
                  </td>
                  <td
                    className="text-slate-light text-right ps-1 pe-0 py-0 align-middle"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {formatActivityDate(activity.startDateLocal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination controls - vertically centered */}
      <div
        className="flex flex-col justify-center ms-2"
        style={{ minWidth: 32, visibility: showPagination ? "visible" : "hidden" }}
      >
        <button
          className="btn btn-sm btn-link p-0 text-slate-light min-h-[44px] min-w-[32px] inline-flex items-center justify-center"
          onClick={() => setPage((p) => p - 1)}
          disabled={!canGoUp}
          style={{ opacity: canGoUp ? 1 : 0.3 }}
          aria-label="Newer activities"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4l5 6H3l5-6z" />
          </svg>
        </button>
        <span
          className="text-slate-light text-center"
          style={{ fontSize: "0.7rem", lineHeight: 1.3 }}
        >
          {page + 1}/{hasMore ? "+" : totalPages}
        </span>
        <button
          className="btn btn-sm btn-link p-0 text-slate-light min-h-[44px] min-w-[32px] inline-flex items-center justify-center"
          onClick={handleNextPage}
          disabled={!canGoDown}
          style={{ opacity: canGoDown ? 1 : 0.3 }}
          aria-label="Older activities"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 12l5-6H3l5 6z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
