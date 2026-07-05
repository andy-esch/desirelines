package ratelimit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

const testRemoteAddr = "1.2.3.4:1234"

func newTestLimiter(ctx context.Context, rate float64, burst int) *Limiter {
	return New(ctx, &Config{
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
		req.RemoteAddr = testRemoteAddr
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
		req.RemoteAddr = testRemoteAddr
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("burst request should pass, got %d", w.Code)
		}
	}

	// This request should be rejected
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = testRemoteAddr
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d, want 429", w.Code)
	}

	// Verify Retry-After header is present and reflects actual delay
	// With rate=0.001 req/s, next token is ~1000s away
	ra := w.Header().Get("Retry-After")
	if ra == "" {
		t.Error("expected Retry-After header to be set")
	}
	if ra != "1000" {
		t.Errorf("Retry-After = %q, want %q", ra, "1000")
	}

	// Verify JSON error body
	var errResp apierrors.ErrorResponse
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

// rejectedCountsByReason collects the desirelines.io/ratelimit/rejected counter
// and returns its datapoints keyed by the "reason" attribute.
func rejectedCountsByReason(t *testing.T, reader sdkmetric.Reader) map[string]int64 {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect metrics: %v", err)
	}
	counts := map[string]int64{}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "desirelines.io/ratelimit/rejected" {
				continue
			}
			sum, ok := m.Data.(metricdata.Sum[int64])
			if !ok {
				t.Fatalf("metric %s: unexpected data type %T", m.Name, m.Data)
			}
			for _, dp := range sum.DataPoints {
				reason, _ := dp.Attributes.Value(attribute.Key("reason"))
				counts[reason.AsString()] += dp.Value
			}
		}
	}
	return counts
}

func TestRejectionCounter(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))

	// Burst=1, MaxClients=1: the first IP fills the only map slot and consumes its
	// single token; a second request from it is over_limit; a new IP is map_full.
	l := New(ctx, &Config{
		Rate:            0.001,
		Burst:           1,
		MaxClients:      1,
		CleanupInterval: time.Hour,
		TTL:             time.Hour,
		Name:            "test",
		Meter:           provider.Meter("test"),
	}, gcplog.NewNoOpLogger())
	handler := l.Middleware(okHandler())

	send := func(remoteAddr string) int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = remoteAddr
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w.Code
	}

	if code := send("1.1.1.1:1"); code != http.StatusOK {
		t.Fatalf("first request: got %d, want 200", code)
	}
	if code := send("1.1.1.1:2"); code != http.StatusTooManyRequests {
		t.Fatalf("over-limit request: got %d, want 429", code)
	}
	if code := send("2.2.2.2:1"); code != http.StatusTooManyRequests {
		t.Fatalf("map-full request: got %d, want 429", code)
	}

	counts := rejectedCountsByReason(t, reader)
	if counts["over_limit"] < 1 {
		t.Errorf("over_limit count = %d, want >= 1", counts["over_limit"])
	}
	if counts["map_full"] < 1 {
		t.Errorf("map_full count = %d, want >= 1", counts["map_full"])
	}
}

func TestSkipBypassesLimiting(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Rate ~0 so the bucket never refills; Skip exempts the "/tiles/" prefix.
	l := New(ctx, &Config{
		Rate:            0.001,
		Burst:           1,
		CleanupInterval: time.Hour,
		TTL:             time.Hour,
		Skip: func(r *http.Request) bool {
			return strings.HasPrefix(r.URL.Path, "/tiles/")
		},
	}, gcplog.NewNoOpLogger())
	handler := l.Middleware(okHandler())

	send := func(path string) int {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = testRemoteAddr
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w.Code
	}

	// Exhaust the single token on a limited (non-skipped) path.
	if got := send("/activities"); got != http.StatusOK {
		t.Fatalf("first limited request: got %d, want 200", got)
	}
	if got := send("/activities"); got != http.StatusTooManyRequests {
		t.Fatalf("second limited request: got %d, want 429", got)
	}

	// The skipped path bypasses the limiter even though the bucket is empty.
	for i := range 3 {
		if got := send("/tiles/9/1/2"); got != http.StatusOK {
			t.Fatalf("skipped request %d: got %d, want 200 (must bypass the empty bucket)", i, got)
		}
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

	l := New(ctx, &Config{
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

	_ = New(ctx, &Config{
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

func TestMaxClients(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	l := New(ctx, &Config{
		Rate:            10,
		Burst:           10,
		MaxClients:      2,
		CleanupInterval: time.Hour,
		TTL:             time.Hour,
	}, gcplog.NewNoOpLogger())

	handler := l.Middleware(okHandler())

	// Fill the map with 2 IPs
	for _, ip := range []string{"10.0.0.1:1000", "10.0.0.2:1000"} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("IP %s: got %d, want 200", ip, w.Code)
		}
	}

	// A third unique IP should be rejected (map full)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.3:1000"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("new IP at capacity: got %d, want 429", w.Code)
	}

	// An existing IP should still be allowed
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:2000"
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("existing IP at capacity: got %d, want 200", w.Code)
	}
}

func TestConfigDefaults(t *testing.T) {
	cfg := Config{Rate: 10, Burst: 20}

	if got := cfg.maxClients(); got != defaultMaxClients {
		t.Errorf("maxClients = %d, want %d", got, defaultMaxClients)
	}
	if got := cfg.cleanupInterval(); got != time.Minute {
		t.Errorf("cleanupInterval = %v, want %v", got, time.Minute)
	}
	if got := cfg.ttl(); got != 5*time.Minute {
		t.Errorf("ttl = %v, want %v", got, 5*time.Minute)
	}
}
