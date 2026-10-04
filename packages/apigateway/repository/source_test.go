package repository

import "testing"

func TestActivitySourceLink(t *testing.T) {
	source, url := ActivitySourceLink(123456789)

	if source != ActivitySourceStrava {
		t.Errorf("source = %q, want %q", source, ActivitySourceStrava)
	}
	if want := "https://www.strava.com/activities/123456789"; url != want {
		t.Errorf("url = %q, want %q", url, want)
	}
}
