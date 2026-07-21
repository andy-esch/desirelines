import { useMemo } from "react";
import { useSportConfig } from "./useSportConfig";

/** Fallback while sport config loads (demo mode / first paint). */
const FALLBACK_SPORT_OPTIONS = [
  { value: "cycling", label: "Cycling" },
  { value: "running", label: "Running" },
  { value: "yoga", label: "Yoga" },
];

export interface SportOption {
  value: string;
  label: string;
}

/**
 * Sport filter options for the Activities-group views — one entry per sport
 * category from config. There is deliberately no "All Sports" entry: the sport
 * chips are multi-select and the empty selection is the all-sports state, so
 * an explicit option would be a second way to express the same thing.
 */
export function useSportOptions(): SportOption[] {
  const { sportConfig } = useSportConfig();
  return useMemo(() => {
    if (!sportConfig) return FALLBACK_SPORT_OPTIONS;
    return Object.entries(sportConfig.sportCategories).map(([key, cat]) => ({
      value: key,
      label: cat.displayName,
    }));
  }, [sportConfig]);
}
