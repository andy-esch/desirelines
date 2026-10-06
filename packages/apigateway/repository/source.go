package repository

import "net/url"

// ActivitySourceStrava names Strava as the platform an activity was synced from.
const ActivitySourceStrava = "strava"

// activityPageURLs holds, per platform, the fixed https prefix of an activity's
// page there; the activity's ID on that platform completes it.
var activityPageURLs = map[string]string{
	ActivitySourceStrava: "https://www.strava.com/activities/",
}

// ActivitySourceLink returns a link to an activity on the platform it was synced
// from, given that platform and the activity's ID there (its external ID, not
// the desirelines ID). An unknown platform or a missing ID gets no link (""), so
// clients never render a guessed one.
func ActivitySourceLink(source, externalID string) string {
	prefix, ok := activityPageURLs[source]
	if !ok || externalID == "" {
		return ""
	}
	return prefix + url.PathEscape(externalID)
}
