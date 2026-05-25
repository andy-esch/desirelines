/**
 * Hardcoded default danger thresholds (sustainable pace limits).
 *
 * Values are expressed in the sport's display unit (e.g. miles/day for distance
 * sports, hours/day for time sports) since paceNeeded is computed in those same
 * display units in GoalSummaryTable.
 *
 * TODO: Move these to sport_types.json or a global system config
 * so they don't live in code. When user-configurable overrides are added
 * to the UserConfig proto, this hook should fetch useUserConfig("preferences")
 * and merge overrides on top of these defaults.
 */
const DEFAULT_DANGER_THRESHOLDS: Record<string, number> = {
  cycling: 20, // miles/day
  running: 10, // miles/day
  yoga: 2, // hours/day
};

/**
 * Hook for accessing danger thresholds for sports.
 *
 * Currently returns hardcoded defaults only. Structured as a hook (rather than
 * a plain utility) so that adding user-specific overrides from Firestore later
 * is a non-breaking change for consumers.
 *
 * @returns An object with a getThreshold(sport) method and allThresholds map
 */
export function useDangerThresholds() {
  const getThreshold = (sport: string): number => {
    return DEFAULT_DANGER_THRESHOLDS[sport] ?? Infinity;
  };

  return {
    getThreshold,
    allThresholds: DEFAULT_DANGER_THRESHOLDS,
  };
}
