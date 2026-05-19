// Package strava provides adapters for the Strava API.
package strava

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway/internal/auth"
	"github.com/andy-esch/desirelines/packages/shared/otel"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/metric"
)

const (
	//nolint:gosec // URL, not credential
	defaultTokenURL     = "https://www.strava.com/oauth/token"
	defaultAuthorizeURL = "https://www.strava.com/oauth/authorize"

	httpClientTimeout     = 10 * time.Second
	maxTokenResponseBytes = 64 << 10 // 64 KB
)

// OAuthClient implements auth.StravaOAuthClient by calling the Strava token endpoint.
type OAuthClient struct {
	httpClient   *http.Client
	clientID     string
	clientSecret string
	tokenURL     string
	logger       *slog.Logger
	histogram    metric.Float64Histogram
}

// Compile-time check that OAuthClient implements StravaOAuthClient.
var _ auth.StravaOAuthClient = (*OAuthClient)(nil)

// NewOAuthClient creates a new Strava OAuth client.
// An optional *http.Client can be provided for testing; if nil, a default client
// with a 10-second timeout is used.
func NewOAuthClient(clientID, clientSecret string, logger *slog.Logger, httpClient *http.Client, histogram metric.Float64Histogram) *OAuthClient {
	if httpClient == nil {
		// otelhttp transport gives the outbound Strava token call an
		// automatic HTTP client span and injects W3C traceparent so the
		// exchange continues the caller's trace. Only the default client
		// is wrapped; test-injected clients are left as-is.
		//
		// Clone() rather than wrapping http.DefaultTransport directly:
		// DefaultTransport is a process-global whose connection pool /
		// timeouts are shared by anything else that uses it; a clone
		// isolates this client's pool. The stdlib DefaultTransport is
		// always *http.Transport; the !ok branch is unreachable in
		// practice and exists only to stay panic-free / lint-clean.
		base, ok := http.DefaultTransport.(*http.Transport)
		if !ok {
			base = &http.Transport{}
		}
		httpClient = &http.Client{
			Timeout: httpClientTimeout,
			Transport: otelhttp.NewTransport(
				base.Clone(),
				otelhttp.WithSpanNameFormatter(func(_ string, _ *http.Request) string {
					// Single-purpose client (token exchange / refresh);
					// a static descriptive name beats the generic
					// "HTTP POST" otelhttp default.
					return "apigateway.strava.oauth_exchange"
				}),
			),
		}
	}
	return &OAuthClient{
		httpClient:   httpClient,
		clientID:     clientID,
		clientSecret: clientSecret,
		tokenURL:     defaultTokenURL,
		logger:       logger,
		histogram:    histogram,
	}
}

// AuthorizeURL returns the Strava OAuth authorization endpoint.
func (c *OAuthClient) AuthorizeURL() string {
	return defaultAuthorizeURL
}

// ExchangeCode exchanges an authorization code for Strava tokens.
func (c *OAuthClient) ExchangeCode(ctx context.Context, code string) (tokenResult *auth.StravaTokenResponse, err error) {
	done := otel.RecordDuration(ctx, c.histogram)
	defer func() { done(err) }()
	form := url.Values{
		"client_id":     {c.clientID},
		"client_secret": {c.clientSecret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			c.logger.Error("Failed to close response body", "error", closeErr)
		}
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxTokenResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		// Truncate error body to avoid leaking sensitive data in logs
		snippet := string(body)
		if len(snippet) > 200 {
			snippet = snippet[:200] + "...(truncated)"
		}
		return nil, fmt.Errorf("strava token exchange returned %d: %s", resp.StatusCode, snippet)
	}

	var tokenResp auth.StravaTokenResponse
	if err = json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}

	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("token response missing access_token")
	}
	if tokenResp.RefreshToken == "" {
		return nil, fmt.Errorf("token response missing refresh_token")
	}

	return &tokenResp, nil
}
