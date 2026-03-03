package strava

import (
	"context"
	"net/url"
	"testing"
)

func TestMockOAuthClient_AuthorizeURL(t *testing.T) {
	tests := []struct {
		name        string
		callbackURL string
		wantHost    string
		wantPath    string
		wantCode    string
	}{
		{
			name:        "localhost callback",
			callbackURL: "http://localhost:8084/auth/callback",
			wantHost:    "localhost:8084",
			wantPath:    "/auth/callback",
			wantCode:    MockAuthCode,
		},
		{
			name:        "custom host",
			callbackURL: "https://dev.example.com/auth/callback",
			wantHost:    "dev.example.com",
			wantPath:    "/auth/callback",
			wantCode:    MockAuthCode,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewMockOAuthClient(tt.callbackURL, 12345, "Test", "User")
			raw := m.AuthorizeURL()

			u, err := url.Parse(raw)
			if err != nil {
				t.Fatalf("AuthorizeURL() returned unparseable URL %q: %v", raw, err)
			}

			if u.Host != tt.wantHost {
				t.Errorf("host = %q, want %q", u.Host, tt.wantHost)
			}
			if u.Path != tt.wantPath {
				t.Errorf("path = %q, want %q", u.Path, tt.wantPath)
			}
			if got := u.Query().Get("code"); got != tt.wantCode {
				t.Errorf("query param code = %q, want %q", got, tt.wantCode)
			}
		})
	}
}

func TestMockOAuthClient_AuthorizeURL_TrailingSlash(t *testing.T) {
	// Verify that a trailing slash on callbackURL doesn't produce a malformed path
	m := NewMockOAuthClient("http://localhost:8084/auth/callback/", 12345, "Test", "User")
	raw := m.AuthorizeURL()

	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("AuthorizeURL() returned unparseable URL %q: %v", raw, err)
	}

	// Path should still be parseable and code should be present
	if got := u.Query().Get("code"); got != MockAuthCode {
		t.Errorf("query param code = %q, want %q", got, MockAuthCode)
	}
}

func TestMockOAuthClient_ExchangeCode(t *testing.T) {
	const (
		athleteID = int64(123456789)
		firstName = "Dev"
		lastName  = "Athlete"
	)

	m := NewMockOAuthClient("http://localhost:8084/auth/callback", athleteID, firstName, lastName)
	resp, err := m.ExchangeCode(context.Background(), "any-code")

	if err != nil {
		t.Fatalf("ExchangeCode() returned error: %v", err)
	}

	if resp.Athlete.ID != athleteID {
		t.Errorf("athlete ID = %d, want %d", resp.Athlete.ID, athleteID)
	}
	if resp.Athlete.FirstName != firstName {
		t.Errorf("first name = %q, want %q", resp.Athlete.FirstName, firstName)
	}
	if resp.Athlete.LastName != lastName {
		t.Errorf("last name = %q, want %q", resp.Athlete.LastName, lastName)
	}
	if resp.AccessToken == "" {
		t.Error("expected non-empty access token")
	}
	if resp.RefreshToken == "" {
		t.Error("expected non-empty refresh token")
	}
	if resp.Scope != "read,activity:read_all" {
		t.Errorf("scope = %q, want %q", resp.Scope, "read,activity:read_all")
	}
	if resp.ExpiresAt <= 0 {
		t.Errorf("expires_at = %d, want positive timestamp", resp.ExpiresAt)
	}
}
