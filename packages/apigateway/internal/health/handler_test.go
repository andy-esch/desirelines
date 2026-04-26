package health

import (
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
			h := NewHandler(tt.pinger, logger)

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
