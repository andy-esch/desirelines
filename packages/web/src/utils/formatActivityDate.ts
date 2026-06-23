/**
 * Format an athlete-local activity date (`YYYY-MM-DD…`) for display. Parses the
 * Y-M-D parts directly (no `Date` string parsing) so there's no timezone shift.
 * `year` includes the year (e.g. the click popover); omit it for compact lists.
 */
export function formatActivityDate(startDateLocal: string, opts?: { year?: boolean }): string {
  const [y, m, d] = startDateLocal.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return startDateLocal.slice(0, 10);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts?.year ? { year: "numeric" as const } : {}),
  });
}
