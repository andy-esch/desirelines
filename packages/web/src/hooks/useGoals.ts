import type { GoalsForYear, SportGoalsForYear } from "../services/userConfigService";
import { useConfigSection } from "./useConfigSection";
import { useConfigDocument } from "./useConfigDocument";

/**
 * One sport's goals for one year: the account's, or the demo's on this device.
 *
 * `goalsForYear` is what's saved; with nothing saved, `suggested` stands in (the sport
 * page's goals from this year's pace), else null. `isSaved` says which.
 */
export function useGoals(year: number, sport: string, suggested?: GoalsForYear) {
  const { value, ...section } = useConfigSection<GoalsForYear>(
    { section: "goals", year, sport },
    suggested
  );
  return { ...section, goalsForYear: value };
}

/**
 * Every goal the session has saved, by year and then sport: the account's, or signed out
 * the demo's on this device. For listing; a change goes through `useGoals`.
 *
 * `goalsByYear` is null while what's saved isn't known (loading, or the first load
 * failed), and empty when nothing is. After a later listener error it's the last good copy.
 */
export function useAllGoals(): {
  goalsByYear: Record<string, SportGoalsForYear> | null;
  loading: boolean;
  error: Error | null;
} {
  const { doc, loading, error } = useConfigDocument();
  return { goalsByYear: doc === undefined ? null : (doc?.goals ?? {}), loading, error };
}
