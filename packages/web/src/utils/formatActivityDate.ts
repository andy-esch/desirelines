import type { DateStyle } from "./dateStyle";
import { pad2 } from "./dateStyle";

/**
 * Format an athlete-local activity date (`YYYY-MM-DD…`) for display. Parses the
 * Y-M-D parts directly (no `Date` string parsing) so there's no timezone shift.
 * `year` includes the year (e.g. the click popover); omit it for compact lists.
 *
 * `style` is the theme's date style; components get it from `useThemeDateFormat()` rather
 * than passing it by hand. Dotted pads the month and day, which is the one place padding is
 * wanted: it keeps a column of dates the same width. Counts are never padded.
 */
export function formatActivityDate(
  startDateLocal: string,
  opts?: { year?: boolean; style?: DateStyle }
): string {
  const [y, m, d] = startDateLocal.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return startDateLocal.slice(0, 10);
  if (opts?.style === "dotted") {
    const md = `${pad2(m)}.${pad2(d)}`;
    return opts.year ? `${y}.${md}` : md;
  }
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts?.year ? { year: "numeric" as const } : {}),
  });
}
