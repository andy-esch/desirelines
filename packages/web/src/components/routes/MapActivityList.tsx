import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { ExternalLinkIcon } from "../ui/ExternalLinkIcon";
import type { MapActivity } from "../../api/map";
import { formatDistance, type DistanceUnit } from "../../utils/units";
import { formatActivityDate } from "../../utils/formatActivityDate";

/** Keep the list compact so the filters above it stay in view. */
const PAGE_SIZE = 5;

export interface MapActivityListProps {
  /** The currently-filtered activities (same set the map + summary show). */
  activities: MapActivity[];
  /** App-category → NEON spectrum color (shared with the chips + map lines). */
  sportColors: Record<string, string>;
  distanceUnit: DistanceUnit;
  /** Activity id selected on the map (highlights + scrolls its row into view). */
  selectedId: number | null;
  /** Row click → select on the map (highlight + fit). */
  onSelect: (activity: MapActivity) => void;
}

const FALLBACK_COLOR = "rgb(150, 150, 150)";

function stravaUrl(activityId: number): string {
  return `https://www.strava.com/activities/${activityId}`;
}

/**
 * Compact, scrollable list of the filtered activities, synced with the map: the
 * selected route's row is highlighted + scrolled into view, and clicking a row
 * selects it on the map. Purpose-built for the narrow drawer (the `/activities`
 * `ActivityTable` is a wide, paginated multi-column table over a different model);
 * shared bits — unit formatters, the spectrum sport colors, the external-link
 * icon — are reused.
 */
export default function MapActivityList({
  activities,
  sportColors,
  distanceUnit,
  selectedId,
  onSelect,
}: MapActivityListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  const total = activities.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Adjust state when props change, via the "store previous value in state" idiom
  // (https://react.dev/reference/react/useState — sanctioned setState-in-render, no
  // effect/ref churn): reset to page 0 when the filtered set changes, and page to
  // the selected row when the selection changes (so a map-click is always on-screen).
  const [prevActivities, setPrevActivities] = useState(activities);
  if (prevActivities !== activities) {
    setPrevActivities(activities);
    setPage(0);
  }
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    if (selectedId != null) {
      const idx = activities.findIndex((a) => a.activityId === selectedId);
      if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE));
    }
  }

  // Clamp if the filtered set shrank under the current page.
  const safePage = Math.min(page, totalPages - 1);

  // Scroll the selected row into view once it's on the current page (DOM effect).
  useEffect(() => {
    if (selectedId == null) return;
    const row = listRef.current?.querySelector(`[data-activity-id="${selectedId}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId, safePage]);

  if (total === 0) return null;

  const start = safePage * PAGE_SIZE;
  const pageItems = activities.slice(start, start + PAGE_SIZE);

  return (
    <section className="px-4 py-3" aria-label="Activities">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="map-activity-list"
          className="flex items-center gap-1 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-light hover:text-body-text"
        >
          <span
            className={cn(
              "transition-transform motion-reduce:transition-none",
              collapsed ? "" : "rotate-90"
            )}
          >
            ▸
          </span>
          Activities ({total.toLocaleString()})
        </button>
        {!collapsed && totalPages > 1 && (
          <div className="flex items-center gap-1 text-xs text-slate-light">
            <span className="tabular-nums">
              {start + 1}–{Math.min(start + PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="Previous page"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="Next page"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              ›
            </Button>
          </div>
        )}
      </div>
      {!collapsed && (
        <ul ref={listRef} id="map-activity-list" className="space-y-0.5">
          {pageItems.map((a) => {
            const isSelected = a.activityId === selectedId;
            return (
              // The select control and the Strava link are SIBLINGS (a native
              // <button> may not contain a focusable <a> — invalid interactive
              // nesting). Native <button> also gives Enter/Space for free.
              <li
                key={a.activityId}
                data-activity-id={a.activityId}
                className={cn(
                  "group flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-accent",
                  isSelected && "bg-accent"
                )}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(a)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: sportColors[a.sport] ?? FALLBACK_COLOR }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-text" title={a.name}>
                      {a.name}
                    </span>
                    <span className="block text-xs tabular-nums text-slate-light">
                      {formatActivityDate(a.startDateLocal)} ·{" "}
                      {formatDistance(a.distanceMeters, distanceUnit)}
                    </span>
                  </span>
                </button>
                <a
                  href={stravaUrl(a.activityId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on Strava"
                  className={cn(
                    "shrink-0 rounded p-1 text-slate-light opacity-0 transition-opacity",
                    "hover:text-accent-cyan focus-visible:opacity-100 group-hover:opacity-100",
                    "motion-reduce:transition-none",
                    isSelected && "opacity-100"
                  )}
                >
                  <ExternalLinkIcon />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
