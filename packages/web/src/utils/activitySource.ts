/**
 * Labels for links to an activity on the platform it was synced from. The API
 * supplies each activity's `source` and `sourceUrl`; the client never builds the
 * URL itself, because an activity's ID is not guaranteed to be the platform's ID.
 */

const SOURCE_NAMES: Record<string, string> = {
  strava: "Strava",
};

/** "View on Strava" for `strava`; unknown sources fall back to their raw name. */
export function viewOnSourceLabel(source: string): string {
  return `View on ${SOURCE_NAMES[source] ?? source}`;
}
