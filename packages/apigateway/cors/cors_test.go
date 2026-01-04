package cors

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewHandler(t *testing.T) {
	t.Run("no origins configured", func(t *testing.T) {
		t.Setenv("ALLOWED_ORIGINS", "")
		h := NewHandler()

		if h == nil {
			t.Fatal("NewHandler returned nil")
		}
		if len(h.allowedOrigins) != 0 {
			t.Errorf("expected 0 allowed origins, got %d", len(h.allowedOrigins))
		}
	})

	t.Run("single origin", func(t *testing.T) {
		t.Setenv("ALLOWED_ORIGINS", "https://example.com")
		h := NewHandler()

		if len(h.allowedOrigins) != 1 {
			t.Errorf("expected 1 allowed origin, got %d", len(h.allowedOrigins))
		}
		if h.allowedOrigins[0] != "https://example.com" {
			t.Errorf("expected https://example.com, got %s", h.allowedOrigins[0])
		}
	})

	t.Run("multiple origins", func(t *testing.T) {
		t.Setenv("ALLOWED_ORIGINS", "https://example.com,http://localhost:3000,https://app.example.com")
		h := NewHandler()

		if len(h.allowedOrigins) != 3 {
			t.Errorf("expected 3 allowed origins, got %d", len(h.allowedOrigins))
		}
	})

	t.Run("trims whitespace", func(t *testing.T) {
		t.Setenv("ALLOWED_ORIGINS", "  https://example.com , http://localhost:3000  ")
		h := NewHandler()

		if len(h.allowedOrigins) != 2 {
			t.Errorf("expected 2 allowed origins, got %d", len(h.allowedOrigins))
		}
		if h.allowedOrigins[0] != "https://example.com" {
			t.Errorf("expected trimmed origin, got %q", h.allowedOrigins[0])
		}
	})

	t.Run("ignores empty entries", func(t *testing.T) {
		t.Setenv("ALLOWED_ORIGINS", "https://example.com,,http://localhost:3000,")
		h := NewHandler()

		if len(h.allowedOrigins) != 2 {
			t.Errorf("expected 2 allowed origins (ignoring empty), got %d", len(h.allowedOrigins))
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

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("ALLOWED_ORIGINS", tt.allowedOrigins)
			h := NewHandler()

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
	t.Run("sets all preflight headers", func(t *testing.T) {
		t.Setenv("ALLOWED_ORIGINS", "https://example.com")
		h := NewHandler()

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

	t.Run("disallowed origin still gets method headers", func(t *testing.T) {
		t.Setenv("ALLOWED_ORIGINS", "https://example.com")
		h := NewHandler()

		req := httptest.NewRequest(http.MethodOptions, "/test", nil)
		req.Header.Set("Origin", "https://evil.com")
		w := httptest.NewRecorder()

		h.HandlePreflight(w, req)

		// Should still return 204
		if w.Code != http.StatusNoContent {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNoContent)
		}

		// Should NOT have Allow-Origin for disallowed origin
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("Access-Control-Allow-Origin should be empty for disallowed origin, got %q", got)
		}

		// But should still have methods header (per CORS spec)
		if got := w.Header().Get("Access-Control-Allow-Methods"); got == "" {
			t.Error("Access-Control-Allow-Methods should be set")
		}
	})
}

// Security-focused tests
func TestHandler_SecurityCases(t *testing.T) {
	t.Run("null origin rejected", func(t *testing.T) {
		t.Setenv("ALLOWED_ORIGINS", "https://example.com")
		h := NewHandler()

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Origin", "null")
		w := httptest.NewRecorder()

		allowed := h.SetHeaders(w, req)
		if allowed {
			t.Error("null origin should be rejected")
		}
	})

	t.Run("wildcard not supported", func(t *testing.T) {
		t.Setenv("ALLOWED_ORIGINS", "*")
		h := NewHandler()

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
		t.Setenv("ALLOWED_ORIGINS", "https://example.com")
		h := NewHandler()

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Origin", "https://sub.example.com")
		w := httptest.NewRecorder()

		allowed := h.SetHeaders(w, req)
		if allowed {
			t.Error("subdomain should not be automatically allowed")
		}
	})
}
