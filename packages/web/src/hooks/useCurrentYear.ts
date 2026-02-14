/**
 * Centralized hook for the current year.
 *
 * Replaces scattered `new Date().getFullYear()` calls across components.
 * For non-hook contexts (plain functions, constants), use getCurrentYear().
 */

/** Get the current year (for use outside React components/hooks) */
export function getCurrentYear(): number {
  return new Date().getFullYear();
}

/** Hook returning the current year (for use in React components/hooks) */
export function useCurrentYear(): number {
  return getCurrentYear();
}
