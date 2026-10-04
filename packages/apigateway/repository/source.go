package repository

import "strconv"

// ActivitySourceStrava names Strava as the platform an activity was synced from.
const ActivitySourceStrava = "strava"

// ActivitySourceLink returns the platform an activity was synced from and a link
// to the activity there. Every activity is a Strava activity today and its ID is
// the Strava activity ID; this is the one place the read path relies on that, so
// clients render the link they are given instead of building one from the ID.
func ActivitySourceLink(activityID int64) (source, url string) {
	return ActivitySourceStrava, "https://www.strava.com/activities/" + strconv.FormatInt(activityID, 10)
}
