package auth

import (
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const stravaAuthorizeURL = "https://www.strava.com/oauth/authorize"

// HandlerConfig holds configuration for the OAuth auth handler.
type HandlerConfig struct {
	Strava      StravaOAuthClient
	Tokens      TokenStore
	Allowlist   AllowlistChecker
	Firebase    FirebaseTokenCreator
	StateSecret []byte
	FrontendURL string
	ClientID    string // Strava client ID (for authorize URL)
	RedirectURI string // AUTH_CALLBACK_URL
	Logger      *slog.Logger
}

// Handler holds dependencies for OAuth auth handlers.
type Handler struct {
	strava      StravaOAuthClient
	tokens      TokenStore
	allowlist   AllowlistChecker
	firebase    FirebaseTokenCreator
	stateSecret []byte
	frontendURL string
	clientID    string
	redirectURI string
	logger      *slog.Logger
}

// NewHandler creates a new OAuth auth handler.
func NewHandler(cfg *HandlerConfig) *Handler {
	return &Handler{
		strava:      cfg.Strava,
		tokens:      cfg.Tokens,
		allowlist:   cfg.Allowlist,
		firebase:    cfg.Firebase,
		stateSecret: cfg.StateSecret,
		frontendURL: cfg.FrontendURL,
		clientID:    cfg.ClientID,
		redirectURI: cfg.RedirectURI,
		logger:      cfg.Logger,
	}
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

	u, parseErr := url.Parse(stravaAuthorizeURL)
	if parseErr != nil {
		h.logger.Error("Failed to parse Strava authorize URL", "error", parseErr)
		h.redirectError(w, r, "server_error")
		return
	}
	u.RawQuery = params.Encode()
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
	if code == "" {
		h.logger.Warn("Missing code parameter in callback")
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
	// Prefer the scope from the token exchange response (server-to-server, trusted)
	// over the query parameter (user-controlled, untrusted). Fall back to the
	// query parameter only if the response doesn't include scopes.
	grantedScope := tokenResp.Scope
	if grantedScope == "" {
		grantedScope = r.URL.Query().Get("scope")
	}

	hasRequiredScope := false
	for _, scope := range strings.Split(grantedScope, ",") {
		if strings.TrimSpace(scope) == "activity:read_all" {
			hasRequiredScope = true
			break
		}
	}
	if !hasRequiredScope {
		h.logger.Warn("Insufficient scopes granted", "granted", grantedScope, "required", "activity:read_all", "athlete_id", athleteID)
		h.redirectError(w, r, "insufficient_scope")
		return
	}

	// Check allowlist
	allowed, err := h.allowlist.IsAllowed(r.Context(), athleteID)
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
	tokenData := &StravaTokenData{
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
	if writeErr := h.tokens.WriteAuthData(r.Context(), athleteID, tokenData, profile); writeErr != nil {
		h.logger.Error("Failed to write auth data", "error", writeErr, "athlete_id", athleteID)
		h.redirectError(w, r, "server_error")
		return
	}

	// Create Firebase custom token
	customToken, err := h.firebase.CustomToken(r.Context(), athleteID)
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
	u, parseErr := url.Parse(h.frontendURL)
	if parseErr != nil {
		h.logger.Error("Failed to parse frontend URL", "error", parseErr)
		h.redirectError(w, r, "server_error")
		return
	}
	u = u.JoinPath("auth", "complete")
	u.Fragment = "token=" + url.QueryEscape(customToken)
	http.Redirect(w, r, u.String(), http.StatusFound)
}

// redirectError redirects the user to the frontend error page with an error code.
func (h *Handler) redirectError(w http.ResponseWriter, r *http.Request, errorCode string) {
	u, parseErr := url.Parse(h.frontendURL)
	if parseErr != nil {
		h.logger.Error("Failed to parse frontend URL for error redirect", "error", parseErr)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	u = u.JoinPath("auth", "error")
	q := u.Query()
	q.Set("error", errorCode)
	u.RawQuery = q.Encode()
	http.Redirect(w, r, u.String(), http.StatusFound)
}
