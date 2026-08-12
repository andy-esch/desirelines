package auth

import (
	"context"
	"crypto/subtle"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode"

	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/allowlist"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// defaultExternalTimeout is the timeout for external service calls (Firestore, Firebase Auth).
const defaultExternalTimeout = 10 * time.Second

const (
	minStateSecretBytes = 32
	maxStateLength      = 2048
	// Firebase Hosting forwards only its reserved __session cookie through a
	// Cloud Run rewrite. The cookie remains host-only because Domain is omitted.
	stateCookieName = "__session"

	scopeActivityReadAll = "activity:read_all"
	paramClientID        = "client_id"
	paramRedirectURI     = "redirect_uri"
	paramResponseType    = "response_type"
	paramScope           = "scope"
	paramApprovalPrompt  = "approval_prompt"
	approvalPromptAuto   = "auto"
	paramState           = "state"
	paramCode            = "code"
)

// HandlerConfig holds configuration for the OAuth auth handler.
type HandlerConfig struct {
	Strava      StravaOAuthClient
	Tokens      TokenStore
	Allowlist   allowlist.Checker
	Firebase    FirebaseAuthClient
	StateSecret []byte
	FrontendURL string
	ClientID    string // Strava client ID (for authorize URL)
	RedirectURI string // AUTH_CALLBACK_URL
	// RequireHTTPS, when true, requires both FrontendURL and RedirectURI
	// to use HTTPS. main.go computes this from
	// !cfg.Environment.IsLocal() so this package stays free of a
	// dependency on the config package.
	RequireHTTPS bool
	Logger       *slog.Logger
}

// Handler holds dependencies for OAuth auth handlers.
type Handler struct {
	strava       StravaOAuthClient
	tokens       TokenStore
	allowlist    allowlist.Checker
	firebase     FirebaseAuthClient
	stateSecret  []byte
	frontendURL  *url.URL
	clientID     string
	redirectURI  string
	initiateURL  string
	stateCookie  string
	secureCookie bool
	logger       *slog.Logger
}

// NewHandler creates a new OAuth auth handler.
// Returns an error if FrontendURL or RedirectURI are not valid URLs.
// When RequireHTTPS is true (any non-local environment), both must use HTTPS.
func NewHandler(cfg *HandlerConfig) (*Handler, error) {
	if len(cfg.StateSecret) < minStateSecretBytes {
		return nil, fmt.Errorf("OAuth state secret must be at least %d bytes", minStateSecretBytes)
	}

	frontendURL, err := validateExternalURL("frontend URL", cfg.FrontendURL, cfg.RequireHTTPS, "would leak Firebase token")
	if err != nil {
		return nil, err
	}

	redirectURL, err := validateExternalURL("redirect URI", cfg.RedirectURI, cfg.RequireHTTPS, "would leak authorization code")
	if err != nil {
		return nil, err
	}

	return &Handler{
		strava:       cfg.Strava,
		tokens:       cfg.Tokens,
		allowlist:    cfg.Allowlist,
		firebase:     cfg.Firebase,
		stateSecret:  cfg.StateSecret,
		frontendURL:  frontendURL,
		clientID:     cfg.ClientID,
		redirectURI:  cfg.RedirectURI,
		initiateURL:  canonicalInitiateURL(redirectURL),
		stateCookie:  stateCookieName,
		secureCookie: cfg.RequireHTTPS,
		logger:       cfg.Logger,
	}, nil
}

// canonicalInitiateURL places the state-minting endpoint on the same origin as
// the configured callback. This makes the host-only state cookie work when a
// deployment exposes multiple Firebase Hosting domains: every login first
// lands on one canonical host, and Strava returns to that same host.
func canonicalInitiateURL(callback *url.URL) string {
	u := *callback
	u.Path = path.Join(path.Dir(u.Path), "strava", "start")
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

// validateExternalURL parses raw and verifies it is an absolute URL (scheme
// and host present). When requireHTTPS is true it additionally requires an
// https scheme, embedding leakReason in the error so the operator sees what a
// plaintext URL would expose. Returns the parsed URL for callers that need it.
func validateExternalURL(label, raw string, requireHTTPS bool, leakReason string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid %s %q: %w", label, raw, err)
	}
	if u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("%s %q must have scheme and host", label, raw)
	}
	if requireHTTPS && u.Scheme != "https" {
		return nil, fmt.Errorf("%s %q must use HTTPS in production (%s)", label, raw, leakReason)
	}
	return u, nil
}

// HandleInitiate handles GET /auth/strava by redirecting the browser to the
// canonical state-minting endpoint on the configured callback origin. It must
// not set the state cookie itself: Firebase Hosting strips every rewritten
// Set-Cookie except __session, and a cookie minted on a non-canonical Hosting
// alias would not be sent to the configured callback host.
func (h *Handler) HandleInitiate(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, h.initiateURL, http.StatusFound)
}

// HandleInitiateStart handles GET /auth/strava/start on the canonical callback
// origin. It generates the browser-bound state and then redirects to Strava.
func (h *Handler) HandleInitiateStart(w http.ResponseWriter, r *http.Request) {
	state, err := generateState(h.stateSecret)
	if err != nil {
		h.logger.Error("Failed to generate state token", "error", err)
		h.redirectError(w, r, "server_error")
		return
	}

	params := url.Values{
		paramClientID:       {h.clientID},
		paramRedirectURI:    {h.redirectURI},
		paramResponseType:   {paramCode},
		paramScope:          {scopeActivityReadAll},
		paramState:          {state},
		paramApprovalPrompt: {approvalPromptAuto},
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
	h.setStateCookie(w, state)
	http.Redirect(w, r, u.String(), http.StatusFound)
}

// setStateCookie binds the signed OAuth state to the browser that initiated the
// flow. Firebase Hosting permits the reserved __session name through its Cloud
// Run rewrite; Cache-Control: no-store on /auth/* prevents the cookie from
// turning these responses into useful CDN cache entries. A signed state value
// alone only proves that this service minted it: an
// attacker can mint one in their own browser and replay it in a victim's
// callback, causing login CSRF/session swapping. Requiring the same value in an
// HttpOnly, SameSite cookie proves that the callback belongs to the initiating
// browser as well.
func (h *Handler) setStateCookie(w http.ResponseWriter, state string) {
	// #nosec G124 -- Secure is true in every deployed environment and false only
	// for loopback HTTP development; HttpOnly and SameSite remain enforced. The
	// cookie is host-only because Domain is deliberately omitted.
	http.SetCookie(w, &http.Cookie{
		Name:     h.stateCookie,
		Value:    state,
		Path:     "/",
		Expires:  time.Now().Add(stateExpiry),
		MaxAge:   int(stateExpiry.Seconds()),
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
}

// clearStateCookie makes the browser binding one-shot. Strava authorization
// codes are one-shot too, but clearing here prevents a failed callback from
// leaving a reusable state credential in the browser for the rest of its TTL.
func (h *Handler) clearStateCookie(w http.ResponseWriter) {
	// #nosec G124 -- Secure must match the environment-specific cookie being
	// deleted; deployed environments always use the Secure __session cookie.
	http.SetCookie(w, &http.Cookie{
		Name:     h.stateCookie,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(1, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
}

// validateAndConsumeState authenticates the callback against the browser that
// initiated the flow and clears the one-shot binding on every path.
func (h *Handler) validateAndConsumeState(w http.ResponseWriter, r *http.Request) bool {
	state := r.URL.Query().Get(paramState)
	stateCookie, cookieErr := r.Cookie(h.stateCookie)
	h.clearStateCookie(w)
	if cookieErr != nil || state == "" || len(state) > maxStateLength ||
		len(stateCookie.Value) > maxStateLength ||
		subtle.ConstantTimeCompare([]byte(state), []byte(stateCookie.Value)) != 1 {
		h.logger.Warn("Missing or mismatched OAuth state cookie")
		h.redirectError(w, r, "invalid_state")
		return false
	}
	if err := validateState(state, h.stateSecret); err != nil {
		h.logger.Warn("Invalid state token", "error", err)
		h.redirectError(w, r, "invalid_state")
		return false
	}
	return true
}

// HandleCallback handles GET /auth/callback.
// Validates the OAuth callback, exchanges the code for tokens, checks the allowlist,
// stores tokens and profile, creates a Firebase custom token, and redirects to the frontend.
func (h *Handler) HandleCallback(w http.ResponseWriter, r *http.Request) {
	// Validate and consume the browser-bound state before handling either a
	// success or error callback. Otherwise an attacker can forge an error
	// callback to disrupt a victim's login, and a signed-but-unbound state still
	// permits login CSRF/session swapping.
	if !h.validateAndConsumeState(w, r) {
		return
	}

	// Check if Strava returned an error (e.g., user denied access) only after
	// authenticating the callback above.
	if errParam := r.URL.Query().Get("error"); errParam != "" {
		h.logger.Warn("Strava OAuth error", "error", errParam)
		h.redirectError(w, r, "access_denied")
		return
	}

	// Validate code parameter
	code := r.URL.Query().Get(paramCode)
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
		grantedScope = r.URL.Query().Get(paramScope)
	}
	if grantedScope == "" {
		h.logger.Warn("No scope in token response or callback query", "athlete_id", athleteID)
		h.redirectError(w, r, "insufficient_scope")
		return "", fmt.Errorf("missing scope")
	}

	// OAuth2 (RFC 6749 §3.3) defines scope as space-separated. Strava currently uses
	// comma-separated, but a future spec-compliance change on their end would silently
	// break every login. Splitting on either keeps us forward-compatible. FieldsFunc
	// drops empty strings, so the runes between separators are already trimmed tokens.
	splitScope := func(r rune) bool { return r == ',' || unicode.IsSpace(r) }
	for _, scope := range strings.FieldsFunc(grantedScope, splitScope) {
		if scope == scopeActivityReadAll {
			return grantedScope, nil
		}
	}

	h.logger.Warn("Insufficient scopes granted", "granted", grantedScope, "required", scopeActivityReadAll, "athlete_id", athleteID)
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
