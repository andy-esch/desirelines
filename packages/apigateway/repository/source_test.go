package repository

import "testing"

func TestActivitySourceLink(t *testing.T) {
	tests := []struct {
		name       string
		source     string
		externalID string
		want       string
	}{
		{"strava", ActivitySourceStrava, "123456789", "https://www.strava.com/activities/123456789"},
		{"unknown source", "garmin", "123456789", ""},
		{"no source", "", "123456789", ""},
		{"no external ID", ActivitySourceStrava, "", ""},
		{"external ID is escaped", ActivitySourceStrava, "a/b?c", "https://www.strava.com/activities/a%2Fb%3Fc"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ActivitySourceLink(tt.source, tt.externalID); got != tt.want {
				t.Errorf("ActivitySourceLink(%q, %q) = %q, want %q", tt.source, tt.externalID, got, tt.want)
			}
		})
	}
}
