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
	"time"

	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/golang-jwt/jwt/v5"
)

// --- Mock implementations with call tracking ---

type mockStravaOAuth struct {
	resp *StravaTokenResponse
	err  error

	calledWith string // captures the code argument
}

func (m *mockStravaOAuth) ExchangeCode(_ context.Context, code string) (*StravaTokenResponse, error) {
	m.calledWith = code
	return m.resp, m.err
}

type mockTokenStore struct {
	writeErr error

	calledWith string // captures the athleteID argument
	called     bool
}

func (m *mockTokenStore) WriteAuthData(_ context.Context, athleteID string, _ *StravaTokenData, _ *AthleteProfile) error {
	m.called = true
	m.calledWith = athleteID
	return m.writeErr
}

type mockAllowlist struct {
	allowed bool
	err     error

	calledWith string
}

func (m *mockAllowlist) IsAllowed(_ context.Context, athleteID string) (bool, error) {
	m.calledWith = athleteID
	return m.allowed, m.err
}

type mockFirebase struct {
	token string
	err   error

	calledWith string

	updateUserCalled bool
	updateUserUID    string
	updateUserParams *firebaseauth.UserToUpdate
	updateUserErr    error
}

func (m *mockFirebase) CustomToken(_ context.Context, uid string) (string, error) {
	m.calledWith = uid
	return m.token, m.err
}

func (m *mockFirebase) UpdateUser(_ context.Context, uid string, params *firebaseauth.UserToUpdate) (*firebaseauth.UserRecord, error) {
	m.updateUserCalled = true
	m.updateUserUID = uid
	m.updateUserParams = params
	return nil, m.updateUserErr
}

// --- Helper ---

func newTestHandler(
	t *testing.T,
	strava StravaOAuthClient,
	tokens TokenStore,
	allowlist AllowlistChecker,
	firebase FirebaseAuthClient,
) *Handler {
	t.Helper()
	h, err := NewHandler(&HandlerConfig{
		Strava:      strava,
		Tokens:      tokens,
		Allowlist:   allowlist,
		Firebase:    firebase,
		StateSecret: []byte("test-secret-key-32-bytes-long!!!"),
		FrontendURL: "https://app.example.com",
		ClientID:    "test-client-id",
		RedirectURI: "https://api.example.com/auth/callback",
		Logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("newTestHandler: %v", err)
	}
	return h
}

// --- HandleInitiate tests ---

func TestHandleInitiate(t *testing.T) {
	h := newTestHandler(t,
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

	// Create an expired state token for the expiry test
	expiredClaims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Minute)),
		IssuedAt:  jwt.NewNumericDate(time.Now().Add(-6 * time.Minute)),
		ID:        "expired-nonce",
	}
	expiredToken := jwt.NewWithClaims(jwt.SigningMethodHS256, expiredClaims)
	expiredState, err := expiredToken.SignedString(stateSecret)
	if err != nil {
		t.Fatalf("failed to create expired state: %v", err)
	}

	validTokenResp := &StravaTokenResponse{
		AccessToken:  "strava-access-token",
		RefreshToken: "strava-refresh-token",
		ExpiresAt:    1234567890,
		Scope:        "read,activity:read_all",
		Athlete: StravaAthlete{
			ID:        12345,
			FirstName: "Jane",
			LastName:  "Doe",
			Profile:   "https://strava.com/avatar.jpg",
		},
	}

	insufficientScopeResp := &StravaTokenResponse{
		AccessToken:  "strava-access-token",
		RefreshToken: "strava-refresh-token",
		ExpiresAt:    1234567890,
		Scope:        "read", // Missing activity:read_all
		Athlete: StravaAthlete{
			ID:        12345,
			FirstName: "Jane",
			LastName:  "Doe",
			Profile:   "https://strava.com/avatar.jpg",
		},
	}

	zeroAthleteResp := &StravaTokenResponse{
		AccessToken:  "strava-access-token",
		RefreshToken: "strava-refresh-token",
		ExpiresAt:    1234567890,
		Scope:        "read,activity:read_all",
		Athlete:      StravaAthlete{ID: 0},
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
			name:         "happy path (scope in JSON)",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: validTokenResp},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{allowed: true},
			firebase:     &mockFirebase{token: "firebase-custom-token"},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/complete#token=firebase-custom-token",
		},
		{
			name:  "happy path (scope in query, not in JSON)",
			query: "code=auth-code&state=" + validState + "&scope=activity:read_all",
			strava: &mockStravaOAuth{resp: &StravaTokenResponse{
				AccessToken:  "tok",
				RefreshToken: "ref",
				ExpiresAt:    12345678,
				Athlete:      StravaAthlete{ID: 12345},
			}},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{allowed: true},
			firebase:     &mockFirebase{token: "fb-token"},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/complete#token=fb-token",
		},
		{
			name:         "insufficient scope (missing from both)",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: insufficientScopeResp},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=insufficient_scope",
		},
		{
			name:  "insufficient scope (missing from query parameter)",
			query: "code=auth-code&state=" + validState + "&scope=read",
			strava: &mockStravaOAuth{resp: &StravaTokenResponse{
				AccessToken:  "tok",
				RefreshToken: "ref",
				ExpiresAt:    12345678,
				Athlete:      StravaAthlete{ID: 12345},
			}},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=insufficient_scope",
		},
		{
			name:  "insufficient scope (JSON response preferred over query param)",
			query: "code=auth-code&state=" + validState + "&scope=activity:read_all",
			strava: &mockStravaOAuth{resp: &StravaTokenResponse{
				AccessToken:  "tok",
				RefreshToken: "ref",
				ExpiresAt:    12345678,
				Scope:        "read",
				Athlete:      StravaAthlete{ID: 12345},
			}},
			tokens:       &mockTokenStore{},
			allowlist:    &mockAllowlist{},
			firebase:     &mockFirebase{},
			wantStatus:   http.StatusFound,
			wantLocation: "/auth/error?error=insufficient_scope",
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
			name:         "expired state",
			query:        "code=auth-code&state=" + expiredState,
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
			name:         "zero athlete ID from Strava",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: zeroAthleteResp},
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
			name:         "write auth data error",
			query:        "code=auth-code&state=" + validState,
			strava:       &mockStravaOAuth{resp: validTokenResp},
			tokens:       &mockTokenStore{writeErr: errors.New("firestore write failed")},
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
			h := newTestHandler(t, tt.strava, tt.tokens, tt.allowlist, tt.firebase)

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

func TestHandleCallback_HappyPathVerifiesArguments(t *testing.T) {
	stateSecret := []byte("test-secret-key-32-bytes-long!!!")

	validState, err := generateState(stateSecret)
	if err != nil {
		t.Fatalf("failed to generate state: %v", err)
	}

	stravaMock := &mockStravaOAuth{resp: &StravaTokenResponse{
		AccessToken:  "access-tok",
		RefreshToken: "refresh-tok",
		ExpiresAt:    9999999999,
		Scope:        "read,activity:read_all",
		Athlete: StravaAthlete{
			ID:        67890,
			FirstName: "Alice",
			LastName:  "Smith",
			Profile:   "https://strava.com/alice.jpg",
		},
	}}
	tokensMock := &mockTokenStore{}
	allowlistMock := &mockAllowlist{allowed: true}
	firebaseMock := &mockFirebase{token: "fb-token"}

	h := newTestHandler(t, stravaMock, tokensMock, allowlistMock, firebaseMock)

	req := httptest.NewRequest(http.MethodGet, "/auth/callback?code=the-code&state="+validState, nil)
	w := httptest.NewRecorder()
	h.HandleCallback(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", http.StatusFound, w.Code)
	}

	// Verify the code was passed to Strava
	if stravaMock.calledWith != "the-code" {
		t.Errorf("ExchangeCode called with %q, want %q", stravaMock.calledWith, "the-code")
	}

	// Verify the athlete ID was passed correctly to all downstream services
	const wantAthleteID = "67890"

	if allowlistMock.calledWith != wantAthleteID {
		t.Errorf("IsAllowed called with %q, want %q", allowlistMock.calledWith, wantAthleteID)
	}

	if firebaseMock.calledWith != wantAthleteID {
		t.Errorf("CustomToken called with %q, want %q", firebaseMock.calledWith, wantAthleteID)
	}

	// Verify WriteAuthData was called with the right athlete ID
	if !tokensMock.called {
		t.Fatal("expected WriteAuthData to be called")
	}
	if tokensMock.calledWith != wantAthleteID {
		t.Errorf("WriteAuthData called with %q, want %q", tokensMock.calledWith, wantAthleteID)
	}

	// Verify UpdateUser was called to sync Strava profile to Firebase
	if !firebaseMock.updateUserCalled {
		t.Fatal("expected UpdateUser to be called")
	}
	if firebaseMock.updateUserUID != wantAthleteID {
		t.Errorf("UpdateUser called with UID %q, want %q", firebaseMock.updateUserUID, wantAthleteID)
	}
}
