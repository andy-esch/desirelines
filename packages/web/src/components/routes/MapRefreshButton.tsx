import { cn } from "@/lib/utils";

/** Circular-arrows glyph; spins while a refresh is in flight. */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export interface MapRefreshButtonProps {
  onRefresh: () => void;
  /** Disables + spins the control while the dataset/regions are (re)fetching. */
  isRefreshing: boolean;
}

/**
 * Pulls the latest map data on demand (Strava sync is backend-driven, so there's no
 * push signal). Bottom-left glass button — clear of the bottom-center dock, the
 * bottom-right zoom control / attribution, and the top corners' drawer toggles.
 */
export default function MapRefreshButton({ onRefresh, isRefreshing }: MapRefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      aria-label={isRefreshing ? "Refreshing map data" : "Refresh map data"}
      className={cn(
        "absolute z-30 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70",
        "bg-card/85 text-slate-light shadow-lg backdrop-blur-md transition-colors",
        "hover:border-accent-cyan/50 hover:text-accent-cyan focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent-cyan/50 disabled:opacity-60",
        // Bottom-left, safe-area-aware (env() is 0 on desktop → a plain 1rem inset there).
        "bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4"
      )}
    >
      <RefreshIcon
        className={cn("h-4 w-4", isRefreshing && "animate-spin motion-reduce:animate-none")}
      />
    </button>
  );
}
