package auth

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// defaultExternalTimeout is the timeout for external service calls (Firestore, Firebase Auth).
const defaultExternalTimeout = 10 * time.Second

// HandlerConfig holds configuration for the OAuth auth handler.
type HandlerConfig struct {
	Strava      StravaOAuthClient
	Tokens      TokenStore
	Allowlist   AllowlistChecker
	Firebase    FirebaseAuthClient
	StateSecret []byte
	FrontendURL string
	ClientID    string // Strava client ID (for authorize URL)
	RedirectURI string // AUTH_CALLBACK_URL
	Environment string // Deployment environment (non-empty = production)
	Logger      *slog.Logger
}

// Handler holds dependencies for OAuth auth handlers.
type Handler struct {
	strava      StravaOAuthClient
	tokens      TokenStore
	allowlist   AllowlistChecker
	firebase    FirebaseAuthClient
	stateSecret []byte
	frontendURL *url.URL
	clientID    string
	redirectURI string
	logger      *slog.Logger
}

// NewHandler creates a new OAuth auth handler.
// Returns an error if FrontendURL or RedirectURI are not valid URLs.
// In production (non-empty Environment), both must use HTTPS.
func NewHandler(cfg *HandlerConfig) (*Handler, error) {
	frontendURL, err := url.Parse(cfg.FrontendURL)
	if err != nil {
		return nil, fmt.Errorf("invalid frontend URL %q: %w", cfg.FrontendURL, err)
	}
	if frontendURL.Scheme == "" || frontendURL.Host == "" {
		return nil, fmt.Errorf("frontend URL %q must have scheme and host", cfg.FrontendURL)
	}
	if cfg.Environment != "" && frontendURL.Scheme != "https" {
		return nil, fmt.Errorf("frontend URL %q must use HTTPS in production (would leak Firebase token)", cfg.FrontendURL)
	}

	redirectURL, err := url.Parse(cfg.RedirectURI)
	if err != nil {
		return nil, fmt.Errorf("invalid redirect URI %q: %w", cfg.RedirectURI, err)
	}
	if redirectURL.Scheme == "" || redirectURL.Host == "" {
		return nil, fmt.Errorf("redirect URI %q must have scheme and host", cfg.RedirectURI)
	}
	if cfg.Environment != "" && redirectURL.Scheme != "https" {
		return nil, fmt.Errorf("redirect URI %q must use HTTPS in production (would leak authorization code)", cfg.RedirectURI)
	}

	return &Handler{
		strava:      cfg.Strava,
		tokens:      cfg.Tokens,
		allowlist:   cfg.Allowlist,
		firebase:    cfg.Firebase,
		stateSecret: cfg.StateSecret,
		frontendURL: frontendURL,
		clientID:    cfg.ClientID,
		redirectURI: cfg.RedirectURI,
		logger:      cfg.Logger,
	}, nil
}

// HandleInitiate handles GET /auth/strava.
// Generates a signed state token and redirects the user to Strava's authorization page.
func (h *Handler) HandleInitiate(w http.ResponseWriter, r *http.Request) {
	state, err := generateState(h.stateSecret)
	if err != nil {
		h.logger.Error("Failed to generate state token", "error", err)
		h.redirectError(w, r, "server_error")
		return
	}

	params := url.Values{
		"client_id":       {h.clientID},
		"redirect_uri":    {h.redirectURI},
		"response_type":   {"code"},
		"scope":           {"activity:read_all"},
		"state":           {state},
		"approval_prompt": {"auto"},
	}

	u, parseErr := url.Parse(h.strava.AuthorizeURL())
	if parseErr != nil {
		h.logger.Error("Failed to parse authorize URL", "error", parseErr)
		h.redirectError(w, r, "server_error")
		return
	}
	// Merge handler params with any existing query params from the URL
	// (e.g., mock adapter may include code=mock-dev-code).
	existing := u.Query()
	for k, v := range params {
		existing[k] = v
	}
	u.RawQuery = existing.Encode()
	http.Redirect(w, r, u.String(), http.StatusFound)
}

// HandleCallback handles GET /auth/callback.
// Validates the OAuth callback, exchanges the code for tokens, checks the allowlist,
// stores tokens and profile, creates a Firebase custom token, and redirects to the frontend.
func (h *Handler) HandleCallback(w http.ResponseWriter, r *http.Request) {
	// Check if Strava returned an error (e.g., user denied access)
	if errParam := r.URL.Query().Get("error"); errParam != "" {
		h.logger.Warn("Strava OAuth error", "error", errParam)
		h.redirectError(w, r, "access_denied")
		return
	}

	// Validate state token
	state := r.URL.Query().Get("state")
	if err := validateState(state, h.stateSecret); err != nil {
		h.logger.Warn("Invalid state token", "error", err)
		h.redirectError(w, r, "invalid_state")
		return
	}

	// Validate code parameter
	code := r.URL.Query().Get("code")
	if code == "" || len(code) > 256 {
		h.logger.Warn("Missing or invalid code parameter in callback", "code_len", len(code))
		h.redirectError(w, r, "missing_code")
		return
	}

	// Exchange authorization code for tokens
	tokenResp, err := h.strava.ExchangeCode(r.Context(), code)
	if err != nil {
		h.logger.Error("Failed to exchange authorization code", "error", err)
		h.redirectError(w, r, "exchange_failed")
		return
	}

	if tokenResp.Athlete.ID <= 0 {
		h.logger.Error("Invalid athlete ID from Strava", "athlete_id", tokenResp.Athlete.ID)
		h.redirectError(w, r, "exchange_failed")
		return
	}

	athleteID := strconv.FormatInt(tokenResp.Athlete.ID, 10)

	// Verify that the user actually granted the required scopes.
	grantedScope, err := h.validateScope(w, r, tokenResp, athleteID)
	if err != nil {
		return // already redirected to error page
	}

	// Timeout for Firestore/Firebase operations
	ctx, cancel := context.WithTimeout(r.Context(), defaultExternalTimeout)
	defer cancel()

	// Check allowlist
	allowed, err := h.allowlist.IsAllowed(ctx, athleteID)
	if err != nil {
		h.logger.Error("Failed to check allowlist", "error", err, "athlete_id", athleteID)
		h.redirectError(w, r, "server_error")
		return
	}
	if !allowed {
		h.logger.Warn("Athlete not on allowlist", "athlete_id", athleteID)
		h.redirectError(w, r, "not_invited")
		return
	}

	// Store tokens and profile atomically in Firestore
	now := time.Now()
	tokenData := &stravatoken.Data{
		AccessToken:   tokenResp.AccessToken,
		RefreshToken:  tokenResp.RefreshToken,
		ExpiresAt:     tokenResp.ExpiresAt,
		Scopes:        grantedScope,
		ConnectedAt:   now,
		LastRefreshed: now,
	}
	profile := &AthleteProfile{
		StravaAthleteID: tokenResp.Athlete.ID,
		FirstName:       tokenResp.Athlete.FirstName,
		LastName:        tokenResp.Athlete.LastName,
		ProfileURL:      tokenResp.Athlete.Profile,
		CreatedAt:       now,
	}
	// WriteAuthData is atomic: token + profile commit together. The
	// syncFirebaseProfile call below is intentionally best-effort —
	// failing the OAuth callback because a Firebase backfill failed
	// would orphan the user with a token they can't access.
	if writeErr := h.tokens.WriteAuthData(ctx, athleteID, tokenData, profile); writeErr != nil {
		h.logger.Error("Failed to write auth data", "error", writeErr, "athlete_id", athleteID)
		h.redirectError(w, r, "server_error")
		return
	}

	// Sync Strava profile to Firebase user record (non-fatal on failure).
	h.syncFirebaseProfile(ctx, athleteID, tokenResp.Athlete)

	// Create Firebase custom token
	customToken, err := h.firebase.CustomToken(ctx, athleteID)
	if err != nil {
		h.logger.Error("Failed to create Firebase custom token", "error", err, "athlete_id", athleteID)
		h.redirectError(w, r, "server_error")
		return
	}

	h.logger.Info("OAuth flow completed successfully", "athlete_id", athleteID)

	// Redirect to frontend with the custom token in a URL fragment.
	// Fragments are never sent to the server, preventing token leakage in
	// server logs, Referer headers, and intermediate proxy logs.
	// The frontend reads the token via window.location.hash.
	u := h.frontendURL.JoinPath("auth", "complete")
	u.Fragment = "token=" + url.QueryEscape(customToken)
	http.Redirect(w, r, u.String(), http.StatusFound)
}

// syncFirebaseProfile sets the display name and photo on the Firebase user record
// so the frontend can show the athlete's name without a separate Firestore read.
// Failures are logged but not propagated — profile sync is best-effort.
func (h *Handler) syncFirebaseProfile(ctx context.Context, athleteID string, athlete StravaAthlete) {
	userUpdate := &firebaseauth.UserToUpdate{}
	hasUpdate := false

	if displayName := strings.TrimSpace(athlete.FirstName + " " + athlete.LastName); displayName != "" {
		userUpdate.DisplayName(displayName)
		hasUpdate = true
	}
	if athlete.Profile != "" {
		userUpdate.PhotoURL(athlete.Profile)
		hasUpdate = true
	}

	if !hasUpdate {
		return
	}
	if _, err := h.firebase.UpdateUser(ctx, athleteID, userUpdate); err != nil {
		h.logger.Warn("Failed to update Firebase user profile", "error", err, "athlete_id", athleteID)
	}
}

// validateScope checks that the OAuth response includes the required activity:read_all scope.
// Prefers the scope from the token exchange response (server-to-server), but falls back to the
// callback query parameter. Strava's POST /oauth/token response does NOT include a "scope" field
// (despite our struct having the tag), so the query parameter is typically the only source.
// The query param is set by Strava's redirect — a user could tamper with it, but the real
// enforcement is at Strava's API: a token without activity:read_all will fail at call time.
//
// Returns the granted scope string and a non-nil error (and redirects to the error page) if
// scope validation fails.
func (h *Handler) validateScope(w http.ResponseWriter, r *http.Request, tokenResp *StravaTokenResponse, athleteID string) (string, error) {
	grantedScope := tokenResp.Scope
	if grantedScope == "" {
		grantedScope = r.URL.Query().Get("scope")
	}
	if grantedScope == "" {
		h.logger.Warn("No scope in token response or callback query", "athlete_id", athleteID)
		h.redirectError(w, r, "insufficient_scope")
		return "", fmt.Errorf("missing scope")
	}

	for _, scope := range strings.Split(grantedScope, ",") {
		if strings.TrimSpace(scope) == "activity:read_all" {
			return grantedScope, nil
		}
	}

	h.logger.Warn("Insufficient scopes granted", "granted", grantedScope, "required", "activity:read_all", "athlete_id", athleteID)
	h.redirectError(w, r, "insufficient_scope")
	return "", fmt.Errorf("insufficient scope: %s", grantedScope)
}

// redirectError redirects the user to the frontend error page with an error code.
func (h *Handler) redirectError(w http.ResponseWriter, r *http.Request, errorCode string) {
	u := h.frontendURL.JoinPath("auth", "error")
	q := u.Query()
	q.Set("error", errorCode)
	u.RawQuery = q.Encode()
	http.Redirect(w, r, u.String(), http.StatusFound)
}
