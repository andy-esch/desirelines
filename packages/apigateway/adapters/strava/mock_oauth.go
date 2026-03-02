package strava

import (
	"context"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
)

// Compile-time check that MockOAuthClient implements StravaOAuthClient.
var _ auth.StravaOAuthClient = (*MockOAuthClient)(nil)

// MockOAuthClient is a development-only Strava OAuth adapter that skips real Strava.
// It returns a hardcoded athlete on ExchangeCode and redirects through the gateway's
// own callback URL so the full OAuth flow (state validation, Firebase token minting)
// still executes.
type MockOAuthClient struct {
	callbackURL string
	athleteID   int64
	firstName   string
	lastName    string
}

// NewMockOAuthClient creates a mock Strava OAuth client for local development.
func NewMockOAuthClient(callbackURL string, athleteID int64, firstName, lastName string) *MockOAuthClient {
	return &MockOAuthClient{
		callbackURL: callbackURL,
		athleteID:   athleteID,
		firstName:   firstName,
		lastName:    lastName,
	}
}

// AuthorizeURL returns the gateway's own callback URL with a mock code pre-filled.
// HandleInitiate merges its params (state, client_id, etc.) into this URL,
// so the browser redirects straight back to the callback handler.
func (m *MockOAuthClient) AuthorizeURL() string {
	return m.callbackURL + "?code=mock-dev-code"
}

// ExchangeCode returns a hardcoded token response with the configured athlete.
func (m *MockOAuthClient) ExchangeCode(_ context.Context, _ string) (*auth.StravaTokenResponse, error) {
	return &auth.StravaTokenResponse{
		AccessToken:  "mock-access-token",
		RefreshToken: "mock-refresh-token",
		ExpiresAt:    time.Now().Add(6 * time.Hour).Unix(),
		Scope:        "read,activity:read_all",
		Athlete: auth.StravaAthlete{
			ID:        m.athleteID,
			FirstName: m.firstName,
			LastName:  m.lastName,
		},
	}, nil
}
