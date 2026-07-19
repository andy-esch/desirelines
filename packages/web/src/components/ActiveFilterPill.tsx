interface FilterOption {
  value: string;
  label: string;
}

/**
 * The active, non-default filter labels for an Activities-group view, e.g.
 * ["6 Months", "Cycling"]. A range equal to the view's default (Charts = "ytd",
 * List = "4w") and an unset sport are both treated as "no filter" and omitted.
 */
export function activeFilterLabels(
  range: string,
  defaultRange: string,
  sport: string,
  timeOptions: FilterOption[],
  sportOptions: FilterOption[]
): string[] {
  const labels: string[] = [];
  if (range !== defaultRange) {
    labels.push(timeOptions.find((o) => o.value === range)?.label ?? range);
  }
  if (sport) {
    labels.push(sportOptions.find((o) => o.value === sport)?.label ?? sport);
  }
  return labels;
}

interface ActiveFilterPillProps {
  /** Active non-default filter labels (from {@link activeFilterLabels}); empty hides the pill. */
  filters: string[];
  /** Reset the view to its defaults. */
  onClear: () => void;
}

/**
 * Floating "a filter is active" pill for the Activities-group content views (List +
 * Charts). Mirrors the map's deep-link pill — same neon `.pill-neon` styling, same
 * top-center overlay + one-tap recourse — so the whole group reads as one system: a
 * left-over or bookmarked filter never looks like missing data. Renders nothing when
 * no non-default filter is active.
 */
export default function ActiveFilterPill({ filters, onClear }: ActiveFilterPillProps) {
  if (filters.length === 0) return null;
  return (
    <div className="pill-neon fixed left-1/2 top-14 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full border bg-slate-dark/85 px-3.5 py-1.5 text-xs text-slate-light shadow-lg backdrop-blur-sm">
      <span aria-hidden="true" className="pill-neon-dot h-1.5 w-1.5 shrink-0 rounded-full" />
      <span>
        <span className="text-slate-lighter">Filtered:</span> {filters.join(" · ")}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear filters and reset to the default view"
        className="font-medium text-accent-cyan transition-[text-shadow] hover:underline hover:[text-shadow:0_0_8px_var(--color-accent-cyan-glow)]"
      >
        Clear
      </button>
    </div>
  );
}
