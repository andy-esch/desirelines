/**
 * Shared constants for sidebar components
 */

/** Years available for selection in the sidebar */
export const AVAILABLE_YEARS = [2025, 2024, 2023] as const;

export type AvailableYear = (typeof AVAILABLE_YEARS)[number];
