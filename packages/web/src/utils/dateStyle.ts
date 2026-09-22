import type { ThemeStructure } from "../themes/registry";

/**
 * How a theme spells dates. The retro designs use two: `Sep 12, 2026`, and a dotted form
 * that reads as a readout, `2026.09.12`.
 *
 * The formatters take this as an argument rather than reading the active theme themselves:
 * several of them are passed to charts as bare `tickFormatter` functions, where no hook can
 * run, and keeping them pure keeps them testable without a DOM. `useThemeDateFormat()` binds
 * the active style at the component boundary.
 */
export type DateStyle = ThemeStructure["dateFormat"];

/** Two digits, for dotted dates only: it keeps a column of them the same width. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The dotted spelling of whatever parts the caller asked for, so a dotted theme honours the
 * same `year` / `month` / `day` choices the short spelling makes — a caller asking for month
 * and year gets `2026.09`, not a day it never requested.
 */
export function dottedDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  const parts: string[] = [];
  if (options.year) parts.push(String(date.getFullYear()));
  if (options.month) parts.push(pad2(date.getMonth() + 1));
  if (options.day) parts.push(pad2(date.getDate()));
  // Nothing recognisable asked for (a weekday-only label, say): leave it to Intl.
  if (parts.length === 0) return date.toLocaleDateString("en-US", options);
  return parts.join(".");
}
