/**
 * Training and activity tracking constants
 */

export const TRAINING_CONSTANTS = {
  MOMENTUM: {
    /** Number of days to look back for training momentum calculation */
    LOOKBACK_DAYS: 14,
    /** Number of days without activity before data is considered stale */
    STALE_ACTIVITY_DAYS: 7,
    /** Thresholds for momentum categorization (percentage change per week) */
    THRESHOLDS: {
      SIGNIFICANTLY_UP: 5, // >5% per week
      UP: 1, // 1-5% per week
      STEADY: -1, // -1% to +1% per week
      DOWN: -5, // -5% to -1% per week
      // Below -5% = significantly-down
    },
  },
  PACE: {
    /** Minimum number of data points required for calculations */
    MIN_DATA_POINTS: 2,
  },
} as const;
