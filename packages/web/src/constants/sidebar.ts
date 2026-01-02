/**
 * Shared constants for sidebar components
 */

/**
 * Generate available years dynamically.
 * Shows current year + 3 years of history.
 */
function generateAvailableYears(): number[] {
  const currentYear = new Date().getFullYear();
  const yearsOfHistory = 3;
  const years: number[] = [];
  for (let i = 0; i <= yearsOfHistory; i++) {
    years.push(currentYear - i);
  }
  return years;
}

/** Years available for selection in the sidebar */
export const AVAILABLE_YEARS = generateAvailableYears();

export type AvailableYear = number;
