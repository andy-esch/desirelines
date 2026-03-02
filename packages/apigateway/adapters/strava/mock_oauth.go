package strava

import (
	"context"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
)

const (
	// MockAuthCode is the authorization code returned in the mock authorize URL.
	MockAuthCode = "mock-dev-code"
	// mockAccessToken is the access token returned by ExchangeCode.
	mockAccessToken = "mock-access-token"
	// mockRefreshToken is the refresh token returned by ExchangeCode.
	mockRefreshToken = "mock-refresh-token"
	// mockScope is the OAuth scope returned by ExchangeCode.
	mockScope = "read,activity:read_all"
	// mockTokenLifetime is how far in the future the mock token expires.
	mockTokenLifetime = 6 * time.Hour
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
	return m.callbackURL + "?code=" + MockAuthCode
}

// ExchangeCode returns a hardcoded token response with the configured athlete.
func (m *MockOAuthClient) ExchangeCode(_ context.Context, _ string) (*auth.StravaTokenResponse, error) {
	return &auth.StravaTokenResponse{
		AccessToken:  mockAccessToken,
		RefreshToken: mockRefreshToken,
		ExpiresAt:    time.Now().Add(mockTokenLifetime).Unix(),
		Scope:        mockScope,
		Athlete: auth.StravaAthlete{
			ID:        m.athleteID,
			FirstName: m.firstName,
			LastName:  m.lastName,
		},
	}, nil
}
