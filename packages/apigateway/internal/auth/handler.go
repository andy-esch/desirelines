package auth

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
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

	authorizeURL := stravaAuthorizeURL + "?" + params.Encode()
	http.Redirect(w, r, authorizeURL, http.StatusFound)
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
		Scopes:        "activity:read_all",
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
	redirectURL := fmt.Sprintf("%s/auth/complete#token=%s", h.frontendURL, url.QueryEscape(customToken))
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// redirectError redirects the user to the frontend error page with an error code.
func (h *Handler) redirectError(w http.ResponseWriter, r *http.Request, errorCode string) {
	redirectURL := fmt.Sprintf("%s/auth/error?error=%s", h.frontendURL, url.QueryEscape(errorCode))
	http.Redirect(w, r, redirectURL, http.StatusFound)
}
