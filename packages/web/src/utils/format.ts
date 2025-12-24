/**
 * String formatting utilities
 */

/**
 * Capitalize the first letter of a string
 * @example capitalizeFirst("cycling") => "Cycling"
 */
export function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
