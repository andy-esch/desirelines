package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"google.golang.org/api/idtoken"
)

type mockOIDCValidator struct {
	payload     *idtoken.Payload
	err         error
	gotToken    string
	gotAudience string
}

func (m *mockOIDCValidator) Validate(_ context.Context, token, audience string) (*idtoken.Payload, error) {
	m.gotToken = token
	m.gotAudience = audience
	return m.payload, m.err
}

func TestOIDCAuthMiddleware(t *testing.T) {
	const (
		audience = "https://desirelines-dev.web.app/api/ready"
		subject  = "123456789012345678901"
	)
	validPayload := func() *idtoken.Payload {
		return &idtoken.Payload{
			Issuer:   "https://accounts.google.com",
			Audience: audience,
			Expires:  time.Now().Add(time.Minute).Unix(),
			IssuedAt: time.Now().Unix(),
			Subject:  subject,
		}
	}

	tests := []struct {
		name       string
		header     string
		validator  *mockOIDCValidator
		wantStatus int
		wantNext   bool
	}{
		{"valid scheduler token", "Bearer signed-token", &mockOIDCValidator{payload: validPayload()}, http.StatusOK, true},
		{"missing token", "", &mockOIDCValidator{}, http.StatusUnauthorized, false},
		{"bad signature", "Bearer bad-token", &mockOIDCValidator{err: errors.New("bad signature")}, http.StatusUnauthorized, false},
		{"wrong subject", "Bearer signed-token", &mockOIDCValidator{payload: func() *idtoken.Payload { p := validPayload(); p.Subject = "other"; return p }()}, http.StatusUnauthorized, false},
		{"wrong issuer", "Bearer signed-token", &mockOIDCValidator{payload: func() *idtoken.Payload { p := validPayload(); p.Issuer = "https://issuer.invalid"; return p }()}, http.StatusUnauthorized, false},
		{"missing issued-at", "Bearer signed-token", &mockOIDCValidator{payload: func() *idtoken.Payload { p := validPayload(); p.IssuedAt = 0; return p }()}, http.StatusUnauthorized, false},
		{"future issued-at", "Bearer signed-token", &mockOIDCValidator{payload: func() *idtoken.Payload {
			p := validPayload()
			p.IssuedAt = time.Now().Add(2 * time.Minute).Unix()
			return p
		}()}, http.StatusUnauthorized, false},
		{"nil payload", "Bearer signed-token", &mockOIDCValidator{}, http.StatusUnauthorized, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nextCalled := false
			m := NewOIDCAuthMiddleware(tt.validator, audience, subject, gcplog.NewNoOpLogger())
			handler := m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				nextCalled = true
				w.WriteHeader(http.StatusOK)
			}))
			req := httptest.NewRequest(http.MethodGet, "/ready", nil)
			if tt.header != "" {
				req.Header.Set("Authorization", tt.header)
			}
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}
			if nextCalled != tt.wantNext {
				t.Errorf("nextCalled = %v, want %v", nextCalled, tt.wantNext)
			}
			if tt.header != "" && tt.validator.err == nil && tt.validator.gotAudience != audience {
				t.Errorf("validator audience = %q, want %q", tt.validator.gotAudience, audience)
			}
			if !tt.wantNext && w.Header().Get("WWW-Authenticate") != "Bearer" {
				t.Error("rejection missing WWW-Authenticate: Bearer")
			}
		})
	}
}
