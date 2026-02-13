package ratelimit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

func newTestLimiter(ctx context.Context, rate float64, burst int) *Limiter {
	return New(ctx, Config{
		Rate:            rate,
		Burst:           burst,
		CleanupInterval: time.Hour, // effectively disabled for most tests
		TTL:             time.Hour,
	}, gcplog.NewNoOpLogger())
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestWithinLimit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	l := newTestLimiter(ctx, 10, 10)
	handler := l.Middleware(okHandler())

	for i := range 10 {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "1.2.3.4:1234"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("request %d: got %d, want 200", i, w.Code)
		}
	}
}

func TestOverLimit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// burst=2, rate very low so no tokens refill during the test
	l := newTestLimiter(ctx, 0.001, 2)
	handler := l.Middleware(okHandler())

	// Exhaust the burst
	for range 2 {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "1.2.3.4:1234"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("burst request should pass, got %d", w.Code)
		}
	}

	// This request should be rejected
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d, want 429", w.Code)
	}

	// Verify Retry-After header
	if ra := w.Header().Get("Retry-After"); ra != "1" {
		t.Errorf("Retry-After = %q, want %q", ra, "1")
	}

	// Verify JSON error body
	var errResp gcplog.ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode error response: %v", err)
	}
	if errResp.Code != "RATE_LIMITED" {
		t.Errorf("error code = %q, want %q", errResp.Code, "RATE_LIMITED")
	}
	if errResp.Error != "Rate limit exceeded" {
		t.Errorf("error message = %q, want %q", errResp.Error, "Rate limit exceeded")
	}
}

func TestPerIPIsolation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	l := newTestLimiter(ctx, 0.001, 1)
	handler := l.Middleware(okHandler())

	// Exhaust IP A's burst
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("IP A first request: got %d, want 200", w.Code)
	}

	// IP A should now be rate limited
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:5678"
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("IP A second request: got %d, want 429", w.Code)
	}

	// IP B should still be allowed
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.2:1234"
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("IP B first request: got %d, want 200", w.Code)
	}
}

func TestPortStripping(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// burst=1: only one request allowed
	l := newTestLimiter(ctx, 0.001, 1)
	handler := l.Middleware(okHandler())

	// First request from port 1111
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "5.6.7.8:1111"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("first request: got %d, want 200", w.Code)
	}

	// Same IP, different port — should share the limiter and be rejected
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "5.6.7.8:2222"
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("same IP different port: got %d, want 429", w.Code)
	}
}

func TestStaleCleanup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	l := New(ctx, Config{
		Rate:            10,
		Burst:           10,
		CleanupInterval: time.Hour, // won't fire automatically
		TTL:             time.Millisecond,
	}, gcplog.NewNoOpLogger())

	// Create an entry
	l.getLimiter("stale-ip")

	// Wait for it to become stale
	time.Sleep(5 * time.Millisecond)

	// Manually trigger cleanup
	l.removeStale()

	l.mu.Lock()
	count := len(l.clients)
	l.mu.Unlock()

	if count != 0 {
		t.Errorf("expected 0 clients after cleanup, got %d", count)
	}
}

func TestCleanupStopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	_ = New(ctx, Config{
		Rate:            10,
		Burst:           10,
		CleanupInterval: time.Millisecond,
		TTL:             time.Millisecond,
	}, gcplog.NewNoOpLogger())

	// Cancel should stop the goroutine (no leaked goroutine)
	cancel()

	// Give it a moment to exit
	time.Sleep(5 * time.Millisecond)
}

func TestStripPort(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"1.2.3.4:5678", "1.2.3.4"},
		{"1.2.3.4", "1.2.3.4"},
		{"[::1]:8080", "::1"},
		{"::1", "::1"},
	}

	for _, tt := range tests {
		got := stripPort(tt.input)
		if got != tt.want {
			t.Errorf("stripPort(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestConfigDefaults(t *testing.T) {
	cfg := Config{Rate: 10, Burst: 20}

	if got := cfg.cleanupInterval(); got != time.Minute {
		t.Errorf("cleanupInterval = %v, want %v", got, time.Minute)
	}
	if got := cfg.ttl(); got != 5*time.Minute {
		t.Errorf("ttl = %v, want %v", got, 5*time.Minute)
	}
}
