import { useUserConfig } from "./useUserConfig";

/**
 * Hardcoded default danger thresholds (sustainable pace limits).
 *
 * Future Plan: Move these to sport_types.json or a global system config
 * so they don't live in code.
 */
const DEFAULT_DANGER_THRESHOLDS: Record<string, number> = {
  cycling: 20, // miles/day
  running: 10, // miles/day
  yoga: 120, // minutes/day
};

/**
 * Hook for accessing danger thresholds for sports.
 *
 * Supports:
 * 1. Global defaults from DEFAULT_DANGER_THRESHOLDS
 * 2. (Future) User-specific overrides from UserConfig
 *
 * Note: Manual memoization (useCallback/useMemo) is omitted as the
 * React Compiler handles reference stability automatically.
 *
 * @returns An object with a getThreshold(sport) method
 */
export function useDangerThresholds() {
  // We currently don't have danger thresholds in the UserConfig proto,
  // but we fetch preferences anyway to make this future-proof.
  const { data: _prefs } = useUserConfig("preferences");

  // Merge global defaults with potential user overrides
  // (User overrides not yet implemented in schema)
  const thresholds = {
    ...DEFAULT_DANGER_THRESHOLDS,
    // ..._prefs?.dangerThresholdOverrides
  };
  const getThreshold = (sport: string): number => {
    return thresholds[sport] ?? Infinity;
  };

  return {
    getThreshold,
    allThresholds: thresholds,
  };
}
