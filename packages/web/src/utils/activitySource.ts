/**
 * Links to an activity on the platform it was ingested from. The API supplies
 * each activity's `source` and `sourceUrl`; the client never builds the URL
 * itself, because an activity's ID is not guaranteed to be the platform's ID.
 */

const SOURCE_NAMES: Record<string, string> = {
  strava: "Strava",
};

/**
 * "View on Strava" for `strava`. An unknown source shows its raw name, and a
 * missing one (the field is typed `string` but list responses are not runtime
 * validated) falls back to a neutral label.
 */
export function viewOnSourceLabel(source: string | undefined): string {
  if (!source) return "View original activity";
  return `View on ${SOURCE_NAMES[source] ?? source}`;
}

/**
 * The href to render for an activity's source URL, or `undefined` when there is
 * none or it is not an `https:` URL. The server builds these links; refusing
 * anything else here means a bad URL drops the link instead of rendering it.
 */
export function sourceHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
