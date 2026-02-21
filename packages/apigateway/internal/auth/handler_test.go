package auth

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// --- Mock implementations ---

type mockStravaOAuth struct {
	resp *StravaTokenResponse
	err  error
}

func (m *mockStravaOAuth) ExchangeCode(_ context.Context, _ string) (*StravaTokenResponse, error) {
	return m.resp, m.err
}

type mockTokenStore struct {
	writeTokensErr  error
	writeProfileErr error
}

func (m *mockTokenStore) WriteTokens(_ context.Context, _ string, _ *StravaTokenData) error {
	return m.writeTokensErr
}

func (m *mockTokenStore) WriteProfile(_ context.Context, _ string, _ *AthleteProfile) error {
	return m.writeProfileErr
}

type mockAllowlist struct {
	allowed bool
	err     error
}

func (m *mockAllowlist) IsAllowed(_ context.Context, _ string) (bool, error) {
	return m.allowed, m.err
}

type mockFirebase struct {
	token string
	err   error
}

func (m *mockFirebase) CustomToken(_ context.Context, _ string) (string, error) {
	return m.token, m.err
}

// --- Helper ---

func newTestHandler(
	strava StravaOAuthClient,
	tokens TokenStore,
	allowlist AllowlistChecker,
	firebase FirebaseTokenCreator,
) *Handler {
	return NewHandler(
		strava,
		tokens,
		allowlist,
		firebase,
		[]byte("test-secret-key-32-bytes-long!!!"),
		"https://app.example.com",
		"test-client-id",
		"https://api.example.com/auth/callback",
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
}

// --- HandleInitiate tests ---

func TestHandleInitiate(t *testing.T) {
	h := newTestHandler(
		&mockStravaOAuth{},
		&mockTokenStore{},
		&mockAllowlist{},
		&mockFirebase{},
	)

	req := httptest.NewRequest(http.MethodGet, "/auth/strava", nil)
	w := httptest.NewRecorder()

	h.HandleInitiate(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("expected status %d, got %d", http.StatusFound, w.Code)
	}

	location := w.Header().Get("Location")
	u, err := url.Parse(location)
	if err != nil {
		t.Fatalf("failed to parse Location header: %v", err)
	}

	if u.Host != "www.strava.com" {
		t.Errorf("expected host www.strava.com, got %s", u.Host)
	}
	if u.Path != "/oauth/authorize" {
		t.Errorf("expected path /oauth/authorize, got %s", u.Path)
	}

	query := u.Query()
	checks := map[string]string{
		"client_id":       "test-client-id",
		"redirect_uri":    "https://api.example.com/auth/callback",
		"response_type":   "code",
		"scope":           "activity:read_all",
		"approval_prompt": "auto",
	}
	for key, want := range checks {
		if got := query.Get(key); got != want {
			t.Errorf("query param %s = %q, want %q", key, got, want)
		}
	}

	if query.Get("state") == "" {
		t.Error("expected non-empty state parameter")
	}
}

// --- HandleCallback tests ---

func TestHandleCallback(t *testing.T) {
	stateSecret := []byte("test-secret-key-32-bytes-long!!!")

	validState, err := generateState(stateSecret)
	if err != nil {
		t.Fatalf("failed to generate state: %v", err)
	}

	validTokenResp := &StravaTokenResponse{
		AccessToken:  "strava-access-token",
		RefreshToken: "strava-refresh-token",
		ExpiresAt:    1234567890,
		Athlete: StravaAthlete{
			ID:        12345,
			FirstName: "Jane",
			LastName:  "Doe",
			Profile:   "https://strava.com/avatar.jpg",
		},
	}

	tests := []struct {
		name         string
		query        string
		strava       *mockStravaOAuth
		tokens       *mockTokenStore
		allowlist    *mockAllowlist
		firebase     *mockFirebase
		wantStatus   int
		wantLocation string // substring match
	}{
		{
			name:         "happy path",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: validTokenResp},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{allowed: true},
			firebase:     &mockFirebase{token: "firebase-custom-token"},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/complete?token=firebase-custom-token",
		},
		{
			name:         "user denied access",
			query:        "error=access_denied",
			strava:       &mockStravaOAuth{},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=access_denied",
		},
		{
			name:         "invalid state",
			query:        "code=auth-code&state=bad-state",
			strava:       &mockStravaOAuth{},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=invalid_state",
		},
		{
			name:         "missing code",
			query:        "state=" + validState,
			strava:       &mockStravaOAuth{},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=missing_code",
		},
		{
			name:         "strava exchange error",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{err: errors.New("strava down")},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=exchange_failed",
		},
		{
			name:         "not on allowlist",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: validTokenResp},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{allowed: false},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=not_invited",
		},
		{
			name:         "allowlist check error",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: validTokenResp},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{err: errors.New("firestore down")},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=server_error",
		},
		{
			name:         "write tokens error",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: validTokenResp},
			tokens:       &mockTokenStore{writeTokensErr: errors.New("firestore write failed")},
			allowlist:    &mockAllowlist{allowed: true},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=server_error",
		},
		{
			name:         "write profile error",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: validTokenResp},
			tokens:       &mockTokenStore{writeProfileErr: errors.New("firestore write failed")},
			allowlist:    &mockAllowlist{allowed: true},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=server_error",
		},
		{
			name:         "firebase token creation error",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: validTokenResp},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{allowed: true},
			firebase:     &mockFirebase{err: errors.New("firebase down")},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=server_error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(tt.strava, tt.tokens, tt.allowlist, tt.firebase)

			req := httptest.NewRequest(http.MethodGet, "/auth/callback?"+tt.query, nil)
			w := httptest.NewRecorder()

			h.HandleCallback(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}

			location := w.Header().Get("Location")
			if tt.wantLocation != "" && !strings.Contains(location, tt.wantLocation) {
				t.Errorf("Location = %q, want substring %q", location, tt.wantLocation)
			}
		})
	}
}
