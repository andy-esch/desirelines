package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"firebase.google.com/go/v4/auth"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// MockTokenVerifier implements TokenVerifier interface
type MockTokenVerifier struct {
	VerifyErr error
	Token     *auth.Token
}

func (m *MockTokenVerifier) VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error) {
	return m.Token, m.VerifyErr
}

func TestAuthMiddleware(t *testing.T) {
	logger := gcplog.NewNoOpLogger()

	tests := []struct {
		name           string
		header         string
		mockVerifier   *MockTokenVerifier
		expectedStatus int
	}{
		{
			name:           "Missing Authorization header",
			header:         "",
			mockVerifier:   &MockTokenVerifier{},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Invalid header format",
			header:         "InvalidToken",
			mockVerifier:   &MockTokenVerifier{},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:   "Invalid token",
			header: "Bearer invalid-token",
			mockVerifier: &MockTokenVerifier{
				VerifyErr: errors.New("invalid token"),
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:   "Valid token",
			header: "Bearer valid-token",
			mockVerifier: &MockTokenVerifier{
				Token: &auth.Token{
					UID: "12345",
				},
			},
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			am := NewAuthMiddleware(tt.mockVerifier, logger, nil, nil)

			// Create a dummy handler that returns 200 OK
			nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})

			handler := am.Middleware(nextHandler)

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.header != "" {
				req.Header.Set("Authorization", tt.header)
			}
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.expectedStatus)
			}
		})
	}
}

func TestAuthMiddleware_InjectsUserID(t *testing.T) {
	logger := gcplog.NewNoOpLogger()

	verifier := &MockTokenVerifier{
		Token: &auth.Token{
			UID: "strava-12345",
		},
	}

	am := NewAuthMiddleware(verifier, logger, nil, nil)

	var capturedUID string
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUID = GetUserID(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := am.Middleware(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if capturedUID != "strava-12345" {
		t.Errorf("GetUserID() = %q, want %q", capturedUID, "strava-12345")
	}
}

func TestAuthMiddleware_StampsEnduserIDOnSpan(t *testing.T) {
	// Pins down the cross-service Cloud Trace contract: when authentication
	// succeeds, the UID is stamped on the active server span as `enduser.id`
	// so a single trace filter `enduser.id=<uid>` finds every span for that
	// user. A regression that drops the stamping (or renames the attribute)
	// would silently break this triage path.
	logger := gcplog.NewNoOpLogger()

	verifier := &MockTokenVerifier{
		Token: &auth.Token{UID: "strava-12345"},
	}

	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tracer := tp.Tracer("test")

	am := NewAuthMiddleware(verifier, logger, nil, tracer)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer valid-token")

	// Start a server-equivalent span on the request context BEFORE the
	// middleware runs — production has otelhttp wrapping the chi router, so
	// by the time auth middleware runs there's already an active span.
	ctx, span := tracer.Start(req.Context(), "test-server-span")
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	am.Middleware(nextHandler).ServeHTTP(w, req)
	span.End()

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	// We expect two ended spans: the test-server-span (parent) and the
	// auth.verify_id_token span (child) emitted by the middleware. Find the
	// server span by name and assert the enduser.id stamp lives on it — the
	// stamp must persist on the request-level span so downstream filtering by
	// `enduser.id=<uid>` finds every operation in the request.
	ended := sr.Ended()
	if len(ended) != 2 {
		t.Fatalf("expected 2 ended spans (server + auth), got %d", len(ended))
	}
	var serverSpan sdktrace.ReadOnlySpan
	names := make([]string, len(ended))
	for i, s := range ended {
		names[i] = s.Name()
		if s.Name() == "test-server-span" {
			serverSpan = s
		}
	}
	if serverSpan == nil {
		t.Fatalf("test-server-span not found in ended spans; got names: %v", names)
	}
	var found bool
	for _, attr := range serverSpan.Attributes() {
		if string(attr.Key) == "enduser.id" {
			if got := attr.Value.AsString(); got != "strava-12345" {
				t.Errorf("enduser.id = %q, want %q", got, "strava-12345")
			}
			found = true
		}
	}
	if !found {
		t.Errorf("enduser.id attribute not set on server span")
	}
}

func TestAuthMiddleware_EmitsVerifySpan(t *testing.T) {
	// The middleware must emit an `auth.verify_id_token` span around the
	// Firebase verification call so Cloud Trace can attribute auth latency
	// independently of the rest of the request. Ergonomics matter: a span
	// search for `name=auth.verify_id_token` must find these for SLO
	// histogram correlation work downstream.
	logger := gcplog.NewNoOpLogger()
	verifier := &MockTokenVerifier{Token: &auth.Token{UID: "strava-12345"}}
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tracer := tp.Tracer("test")
	am := NewAuthMiddleware(verifier, logger, nil, tracer)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	w := httptest.NewRecorder()
	am.Middleware(nextHandler).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	ended := sr.Ended()
	var verifySpan sdktrace.ReadOnlySpan
	for _, s := range ended {
		if s.Name() == "auth.verify_id_token" {
			verifySpan = s
			break
		}
	}
	if verifySpan == nil {
		names := make([]string, len(ended))
		for i, s := range ended {
			names[i] = s.Name()
		}
		t.Fatalf("auth.verify_id_token span not found; got names: %v", names)
	}
	if got := verifySpan.Status().Code.String(); got != "Unset" && got != "Ok" {
		t.Errorf("verify span status = %q, want Unset or Ok on success", got)
	}
}

func TestAuthMiddleware_VerifySpanRecordsErrorOnFailure(t *testing.T) {
	// When VerifyIDToken fails, the auth.verify_id_token span must record
	// ERROR status so Cloud Trace's status facet finds these and SLO
	// burn-rate alerts can include token-verification failures.
	logger := gcplog.NewNoOpLogger()
	verifier := &MockTokenVerifier{VerifyErr: errors.New("invalid token signature")}
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tracer := tp.Tracer("test")
	am := NewAuthMiddleware(verifier, logger, nil, tracer)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer bad-token")
	w := httptest.NewRecorder()
	am.Middleware(nextHandler).ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}

	ended := sr.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	if got := ended[0].Status().Code.String(); got != "Error" {
		t.Errorf("verify span status = %q, want Error", got)
	}
}

func TestAuthMiddleware_NoSpanIsNoOp(t *testing.T) {
	// Defensive sibling to StampsEnduserIDOnSpan: if there's no active span
	// (e.g. unit-test scaffolding without otelhttp), the middleware must not
	// panic — auth must still succeed and inject the UID into context.
	logger := gcplog.NewNoOpLogger()
	verifier := &MockTokenVerifier{Token: &auth.Token{UID: "strava-12345"}}
	am := NewAuthMiddleware(verifier, logger, nil, nil)

	var capturedUID string
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUID = GetUserID(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	w := httptest.NewRecorder()

	am.Middleware(nextHandler).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if capturedUID != "strava-12345" {
		t.Errorf("GetUserID = %q, want %q", capturedUID, "strava-12345")
	}
}

func TestGetUserID_MissingFromContext(t *testing.T) {
	ctx := context.Background()
	uid := GetUserID(ctx)
	if uid != "" {
		t.Errorf("GetUserID() = %q, want empty string", uid)
	}
}
