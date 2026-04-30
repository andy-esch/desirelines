package cors

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewHandler(t *testing.T) {
	logger := slog.Default()

	t.Run("no origins configured", func(t *testing.T) {
		h, err := NewHandler([]string{}, logger, false)
		if err != nil {
			t.Fatalf("NewHandler returned unexpected error: %v", err)
		}

		if len(h.allowedOrigins) != 0 {
			t.Errorf("expected 0 allowed origins, got %d", len(h.allowedOrigins))
		}
	})

	t.Run("single origin", func(t *testing.T) {
		h, err := NewHandler([]string{"https://example.com"}, logger, false)
		if err != nil {
			t.Fatalf("NewHandler returned unexpected error: %v", err)
		}

		if len(h.allowedOrigins) != 1 {
			t.Errorf("expected 1 allowed origin, got %d", len(h.allowedOrigins))
		}
		if !h.allowedOrigins["https://example.com"] {
			t.Error("expected https://example.com to be in allowed origins map")
		}
	})

	t.Run("multiple origins", func(t *testing.T) {
		h, err := NewHandler([]string{"https://example.com", "http://localhost:3000", "https://app.example.com"}, logger, false)
		if err != nil {
			t.Fatalf("NewHandler returned unexpected error: %v", err)
		}

		if len(h.allowedOrigins) != 3 {
			t.Errorf("expected 3 allowed origins, got %d", len(h.allowedOrigins))
		}
	})

	t.Run("strict mode rejects empty origins", func(t *testing.T) {
		h, err := NewHandler([]string{}, logger, true)
		if err == nil {
			t.Fatalf("expected error in strict mode with empty origins, got handler %+v", h)
		}
		if h != nil {
			t.Errorf("expected nil handler on error, got %+v", h)
		}
	})

	t.Run("strict mode accepts non-empty origins", func(t *testing.T) {
		h, err := NewHandler([]string{"https://example.com"}, logger, true)
		if err != nil {
			t.Fatalf("strict mode with non-empty origins should succeed, got error: %v", err)
		}
		if h == nil || len(h.allowedOrigins) != 1 {
			t.Errorf("expected handler with 1 origin, got %+v", h)
		}
	})
}

func TestHandler_SetHeaders(t *testing.T) {
	tests := []struct {
		name           string
		allowedOrigins string
		requestOrigin  string
		wantAllowed    bool
		wantHeader     string
	}{
		{
			name:           "allowed origin gets header",
			allowedOrigins: "https://example.com,http://localhost:3000",
			requestOrigin:  "https://example.com",
			wantAllowed:    true,
			wantHeader:     "https://example.com",
		},
		{
			name:           "second allowed origin",
			allowedOrigins: "https://example.com,http://localhost:3000",
			requestOrigin:  "http://localhost:3000",
			wantAllowed:    true,
			wantHeader:     "http://localhost:3000",
		},
		{
			name:           "disallowed origin blocked",
			allowedOrigins: "https://example.com",
			requestOrigin:  "https://evil.com",
			wantAllowed:    false,
			wantHeader:     "",
		},
		{
			name:           "no origin header (same-origin request)",
			allowedOrigins: "https://example.com",
			requestOrigin:  "",
			wantAllowed:    true,
			wantHeader:     "",
		},
		{
			name:           "empty allowlist blocks all",
			allowedOrigins: "",
			requestOrigin:  "https://example.com",
			wantAllowed:    false,
			wantHeader:     "",
		},
		{
			name:           "case sensitive origin check",
			allowedOrigins: "https://example.com",
			requestOrigin:  "https://EXAMPLE.COM",
			wantAllowed:    false,
			wantHeader:     "",
		},
		{
			name:           "partial match not allowed",
			allowedOrigins: "https://example.com",
			requestOrigin:  "https://example.com.evil.com",
			wantAllowed:    false,
			wantHeader:     "",
		},
		{
			name:           "scheme matters",
			allowedOrigins: "https://example.com",
			requestOrigin:  "http://example.com",
			wantAllowed:    false,
			wantHeader:     "",
		},
		{
			name:           "port matters",
			allowedOrigins: "http://localhost:3000",
			requestOrigin:  "http://localhost:3001",
			wantAllowed:    false,
			wantHeader:     "",
		},
	}

	logger := slog.Default()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var origins []string
			if tt.allowedOrigins != "" {
				origins = strings.Split(tt.allowedOrigins, ",")
			}
			h, err := NewHandler(origins, logger, false)
			if err != nil {
				t.Fatalf("NewHandler returned unexpected error: %v", err)
			}

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			if tt.requestOrigin != "" {
				req.Header.Set("Origin", tt.requestOrigin)
			}
			w := httptest.NewRecorder()

			got := h.SetHeaders(w, req)

			if got != tt.wantAllowed {
				t.Errorf("SetHeaders() = %v, want %v", got, tt.wantAllowed)
			}

			gotHeader := w.Header().Get("Access-Control-Allow-Origin")
			if gotHeader != tt.wantHeader {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", gotHeader, tt.wantHeader)
			}

			// Check credentials header is set when origin is allowed
			if tt.wantAllowed && tt.requestOrigin != "" {
				credHeader := w.Header().Get("Access-Control-Allow-Credentials")
				if credHeader != "true" {
					t.Errorf("Access-Control-Allow-Credentials = %q, want 'true'", credHeader)
				}
			}
		})
	}
}

func TestHandler_HandlePreflight(t *testing.T) {
	logger := slog.Default()

	t.Run("sets all preflight headers", func(t *testing.T) {
		h, err := NewHandler([]string{"https://example.com"}, logger, false)
		if err != nil {
			t.Fatalf("NewHandler returned unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodOptions, "/test", nil)
		req.Header.Set("Origin", "https://example.com")
		w := httptest.NewRecorder()

		h.HandlePreflight(w, req)

		// Check status
		if w.Code != http.StatusNoContent {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNoContent)
		}

		// Check required headers
		checks := map[string]string{
			"Access-Control-Allow-Origin":  "https://example.com",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
			"Access-Control-Max-Age":       "3600",
		}

		for header, want := range checks {
			got := w.Header().Get(header)
			if got != want {
				t.Errorf("%s = %q, want %q", header, got, want)
			}
		}
	})

	t.Run("disallowed origin gets no CORS headers", func(t *testing.T) {
		h, err := NewHandler([]string{"https://example.com"}, logger, false)
		if err != nil {
			t.Fatalf("NewHandler returned unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodOptions, "/test", nil)
		req.Header.Set("Origin", "https://evil.com")
		w := httptest.NewRecorder()

		h.HandlePreflight(w, req)

		// Should still return 204
		if w.Code != http.StatusNoContent {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNoContent)
		}

		// Should NOT have any CORS headers for disallowed origin
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("Access-Control-Allow-Origin should be empty for disallowed origin, got %q", got)
		}
		if got := w.Header().Get("Access-Control-Allow-Methods"); got != "" {
			t.Errorf("Access-Control-Allow-Methods should be empty for disallowed origin, got %q", got)
		}
		if got := w.Header().Get("Access-Control-Allow-Headers"); got != "" {
			t.Errorf("Access-Control-Allow-Headers should be empty for disallowed origin, got %q", got)
		}
	})
}

// Security-focused tests
func TestHandler_SecurityCases(t *testing.T) {
	logger := slog.Default()

	t.Run("null origin rejected", func(t *testing.T) {
		h, err := NewHandler([]string{"https://example.com"}, logger, false)
		if err != nil {
			t.Fatalf("NewHandler returned unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Origin", "null")
		w := httptest.NewRecorder()

		allowed := h.SetHeaders(w, req)
		if allowed {
			t.Error("null origin should be rejected")
		}
	})

	t.Run("wildcard not supported", func(t *testing.T) {
		h, err := NewHandler([]string{"*"}, logger, false)
		if err != nil {
			t.Fatalf("NewHandler returned unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Origin", "https://example.com")
		w := httptest.NewRecorder()

		allowed := h.SetHeaders(w, req)
		// Wildcard is stored as literal "*", not a pattern
		if allowed {
			t.Error("wildcard should not match arbitrary origins (we use explicit allowlist)")
		}
	})

	t.Run("subdomain not automatically allowed", func(t *testing.T) {
		h, err := NewHandler([]string{"https://example.com"}, logger, false)
		if err != nil {
			t.Fatalf("NewHandler returned unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Origin", "https://sub.example.com")
		w := httptest.NewRecorder()

		allowed := h.SetHeaders(w, req)
		if allowed {
			t.Error("subdomain should not be automatically allowed")
		}
	})
}
