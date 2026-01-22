package health

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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

func TestHandler_Handle(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

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
			expectedStatus: http.StatusOK,
			expectedBody: Response{
				Status:   StatusHealthy,
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

			req := httptest.NewRequest(http.MethodGet, "/health", nil)
			w := httptest.NewRecorder()

			h.Handle(w, req)

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

// TestHandler_Handle_JSONOmitEmpty verifies that the Database field is omitted
// from JSON output when empty (nil pinger case). This tests the `omitempty` tag.
func TestHandler_Handle_JSONOmitEmpty(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := NewHandler(nil, logger)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	h.Handle(w, req)

	body := w.Body.String()

	// The "database" key should not appear in JSON when pinger is nil
	if strings.Contains(body, "database") {
		t.Errorf("JSON output should not contain 'database' key when pinger is nil, got: %s", body)
	}

	// Should contain "status":"healthy"
	if !strings.Contains(body, `"status":"healthy"`) {
		t.Errorf("JSON output should contain status:healthy, got: %s", body)
	}
}

// TestHandler_Handle_HTTPMethods verifies the handler responds to various HTTP methods.
// Health endpoints typically accept any method (especially GET and HEAD).
func TestHandler_Handle_HTTPMethods(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := NewHandler(&mockPinger{pingErr: nil}, logger)

	methods := []string{
		http.MethodGet,
		http.MethodHead,
		http.MethodPost, // Some health check systems use POST
	}

	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/health", nil)
			w := httptest.NewRecorder()

			h.Handle(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("%s: status = %d, want %d", method, w.Code, http.StatusOK)
			}
		})
	}
}

// TestHandler_Handle_ContentType verifies the response has correct Content-Type header.
func TestHandler_Handle_ContentType(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := NewHandler(&mockPinger{pingErr: nil}, logger)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	h.Handle(w, req)

	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Content-Type = %q, want %q", contentType, "application/json")
	}
}
