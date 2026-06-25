package health

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// mockPinger is a minimal mock that only implements the Pinger interface.
// This demonstrates the benefit of Interface Segregation - tests only need
// to implement what the handler actually uses.
type mockPinger struct {
	pingErr error
}

func (m *mockPinger) Ping(ctx context.Context) error {
	return m.pingErr
}

// failingPinger fails the test if Ping is invoked. Used to assert that
// HandleLive never touches the database — the cost-protection invariant
// the entire split exists for.
type failingPinger struct {
	t *testing.T
}

func (p *failingPinger) Ping(ctx context.Context) error {
	p.t.Helper()
	p.t.Fatal("HandleLive must not call Pinger.Ping (regression: liveness should not touch DB)")
	return nil
}

// countingPinger records call counts. Useful when we want to assert ordering
// or counts without failing immediately.
type countingPinger struct {
	calls   atomic.Int64
	pingErr error
}

func (p *countingPinger) Ping(ctx context.Context) error {
	p.calls.Add(1)
	return p.pingErr
}

// sequencePinger returns a different error per call, indexed by call count
// (zero-based). Out-of-range calls return the last entry. Used for retry
// tests where attempt #1 and #2 should produce different outcomes.
type sequencePinger struct {
	calls atomic.Int64
	errs  []error
}

func (p *sequencePinger) Ping(ctx context.Context) error {
	idx := int(p.calls.Add(1) - 1)
	if idx >= len(p.errs) {
		idx = len(p.errs) - 1
	}
	return p.errs[idx]
}

func TestHandleLive(t *testing.T) {
	logger := gcplog.NewNoOpLogger()

	t.Run("returns 200 with healthy status", func(t *testing.T) {
		// Use failingPinger so the test fails immediately if HandleLive
		// regresses and starts calling Ping.
		h := NewHandler(&failingPinger{t: t}, logger)

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()

		h.HandleLive(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
		}

		var got Response
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		want := Response{Status: StatusHealthy}
		if got != want {
			t.Errorf("response = %+v, want %+v", got, want)
		}
	})

	t.Run("does not call Pinger.Ping (counted)", func(t *testing.T) {
		// Belt-and-suspenders: also use a counting pinger to make the
		// invariant explicit in the test name and assertion.
		pinger := &countingPinger{}
		h := NewHandler(pinger, logger)

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()

		h.HandleLive(w, req)

		if got := pinger.calls.Load(); got != 0 {
			t.Errorf("Pinger.Ping was called %d times; HandleLive must never call it", got)
		}
		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
		}
	})

	t.Run("omits database field from JSON", func(t *testing.T) {
		h := NewHandler(&failingPinger{t: t}, logger)

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()

		h.HandleLive(w, req)

		body := w.Body.String()
		if strings.Contains(body, "database") {
			t.Errorf("HandleLive JSON should not contain 'database' key, got: %s", body)
		}
		if !strings.Contains(body, `"status":"healthy"`) {
			t.Errorf("HandleLive JSON should contain status:healthy, got: %s", body)
		}
	})

	t.Run("Content-Type is application/json", func(t *testing.T) {
		h := NewHandler(&failingPinger{t: t}, logger)

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()

		h.HandleLive(w, req)

		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want %q", ct, "application/json")
		}
	})
}

func TestHandleReady(t *testing.T) {
	logger := gcplog.NewNoOpLogger()

	tests := []struct {
		name           string
		pinger         Pinger
		expectedStatus int
		expectedBody   Response
	}{
		{
			name:           "healthy database",
			pinger:         &mockPinger{pingErr: nil},
			expectedStatus: http.StatusOK,
			expectedBody: Response{
				Status:   StatusHealthy,
				Database: StatusHealthy,
			},
		},
		{
			name:           "unhealthy database",
			pinger:         &mockPinger{pingErr: errors.New("connection refused")},
			expectedStatus: http.StatusServiceUnavailable,
			expectedBody: Response{
				Status:   StatusUnhealthy,
				Database: StatusUnhealthy,
			},
		},
		{
			name:           "nil pinger (no database configured)",
			pinger:         nil,
			expectedStatus: http.StatusOK,
			expectedBody: Response{
				Status:   StatusHealthy,
				Database: "", // Empty string; omitempty ensures this is omitted from JSON
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Zero retry backoff to keep failure-path tests fast — retry logic
			// itself is exercised in TestHandleReady_Retry below.
			h := NewHandlerWithOptions(tt.pinger, logger, DefaultHealthCheckTimeout, 0)

			req := httptest.NewRequest(http.MethodGet, "/ready", nil)
			w := httptest.NewRecorder()

			h.HandleReady(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.expectedStatus)
			}

			var got Response
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatalf("failed to unmarshal response: %v", err)
			}

			if got != tt.expectedBody {
				t.Errorf("response = %+v, want %+v", got, tt.expectedBody)
			}
		})
	}
}

// TestHandleReady_Retry covers the retry-after-backoff path added for Neon
// tail-latency tolerance. Three scenarios: success on first try (no retry),
// transient failure recovered on retry (200), persistent failure (503).
func TestHandleReady_Retry(t *testing.T) {
	logger := gcplog.NewNoOpLogger()

	t.Run("success on first try makes no second call", func(t *testing.T) {
		pinger := &countingPinger{} // pingErr nil → success
		h := NewHandlerWithOptions(pinger, logger, DefaultHealthCheckTimeout, 0)

		req := httptest.NewRequest(http.MethodGet, "/ready", nil)
		w := httptest.NewRecorder()
		h.HandleReady(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", w.Code)
		}
		if got := pinger.calls.Load(); got != 1 {
			t.Errorf("Ping called %d times, want 1 (no retry on success)", got)
		}
	})

	t.Run("first call fails, second succeeds returns 200", func(t *testing.T) {
		pinger := &sequencePinger{errs: []error{errors.New("transient timeout"), nil}}
		h := NewHandlerWithOptions(pinger, logger, DefaultHealthCheckTimeout, 0)

		req := httptest.NewRequest(http.MethodGet, "/ready", nil)
		w := httptest.NewRecorder()
		h.HandleReady(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want 200 (retry should recover)", w.Code)
		}
		if got := pinger.calls.Load(); got != 2 {
			t.Errorf("Ping called %d times, want 2 (one initial + one retry)", got)
		}

		var resp Response
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if resp.Database != StatusHealthy {
			t.Errorf("database = %q, want %q", resp.Database, StatusHealthy)
		}
	})

	t.Run("both calls fail returns 503 with one retry", func(t *testing.T) {
		pinger := &countingPinger{pingErr: errors.New("persistent failure")}
		h := NewHandlerWithOptions(pinger, logger, DefaultHealthCheckTimeout, 0)

		req := httptest.NewRequest(http.MethodGet, "/ready", nil)
		w := httptest.NewRecorder()
		h.HandleReady(w, req)

		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("status = %d, want 503", w.Code)
		}
		if got := pinger.calls.Load(); got != 2 {
			t.Errorf("Ping called %d times, want exactly 2 (one initial + one retry, no more)", got)
		}
	})
}

// TestHandleReady_MonitoredEventContract pins the contract between this handler
// and the Terraform log-based metric apigateway_readiness_failures, which filters
// on jsonPayload.event="readiness_db_unhealthy". The metric is supposed to sit at
// zero, so it can't be monitored for its own breakage — if a refactor reworded
// or dropped the event field, the alert would silently stop firing. This test is
// the guard: it fails CI the moment the genuine-failure path stops emitting
// exactly one monitored event, OR a recovered cold start starts emitting one.
func TestHandleReady_MonitoredEventContract(t *testing.T) {
	// Count log records carrying the monitored event, and fail if a transient
	// "retrying" line ever carries it (that would re-introduce the false-page).
	countMonitored := func(t *testing.T, raw string) int {
		t.Helper()
		n := 0
		for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
			if line == "" {
				continue
			}
			var rec struct {
				Message string `json:"message"`
				Event   string `json:"event"`
			}
			if err := json.Unmarshal([]byte(line), &rec); err != nil {
				t.Fatalf("log line is not JSON: %q (%v)", line, err)
			}
			if rec.Event != LogEventReadinessDBUnhealthy {
				continue
			}
			n++
			if strings.Contains(rec.Message, "retrying") {
				t.Errorf("transient retry line carries the monitored event %q; recovered cold starts would false-page", LogEventReadinessDBUnhealthy)
			}
		}
		return n
	}

	exercise := func(pinger Pinger) string {
		var buf bytes.Buffer
		logger := gcplog.NewWithOptions(gcplog.Options{Writer: &buf})
		// Zero backoff: the retry path runs, just without the real sleep.
		h := NewHandlerWithOptions(pinger, logger, DefaultHealthCheckTimeout, 0)
		req := httptest.NewRequest(http.MethodGet, "/ready", nil)
		h.HandleReady(httptest.NewRecorder(), req)
		return buf.String()
	}

	t.Run("genuine failure emits exactly one monitored event", func(t *testing.T) {
		raw := exercise(&countingPinger{pingErr: errors.New("persistent failure")})
		if n := countMonitored(t, raw); n != 1 {
			t.Errorf("monitored events = %d, want exactly 1", n)
		}
	})

	t.Run("recovered cold start emits no monitored event", func(t *testing.T) {
		raw := exercise(&sequencePinger{errs: []error{errors.New("transient timeout"), nil}})
		if n := countMonitored(t, raw); n != 0 {
			t.Errorf("monitored events = %d, want 0 (a recovered probe must not page)", n)
		}
	})
}

// TestHandleReady_JSONOmitEmpty verifies that the Database field is omitted
// from JSON output when empty (nil pinger case).
func TestHandleReady_JSONOmitEmpty(t *testing.T) {
	logger := gcplog.NewNoOpLogger()
	h := NewHandler(nil, logger)

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	w := httptest.NewRecorder()

	h.HandleReady(w, req)

	body := w.Body.String()

	if strings.Contains(body, "database") {
		t.Errorf("JSON output should not contain 'database' key when pinger is nil, got: %s", body)
	}

	if !strings.Contains(body, `"status":"healthy"`) {
		t.Errorf("JSON output should contain status:healthy, got: %s", body)
	}
}

// TestHandleReady_ContentType verifies the response has correct Content-Type header.
func TestHandleReady_ContentType(t *testing.T) {
	logger := gcplog.NewNoOpLogger()
	h := NewHandler(&mockPinger{pingErr: nil}, logger)

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	w := httptest.NewRecorder()

	h.HandleReady(w, req)

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Content-Type = %q, want %q", contentType, "application/json")
	}
}
