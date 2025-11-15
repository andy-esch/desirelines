package cors

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestNewHandler(t *testing.T) {
	tests := []struct {
		name           string
		envValue       string
		expectedCount  int
		expectedOrigins []string
	}{
		{
			name:           "single allowed origin",
			envValue:       "https://example.com",
			expectedCount:  1,
			expectedOrigins: []string{"https://example.com"},
		},
		{
			name:           "multiple allowed origins",
			envValue:       "https://example.com,https://app.example.com,https://test.example.com",
			expectedCount:  3,
			expectedOrigins: []string{"https://example.com", "https://app.example.com", "https://test.example.com"},
		},
		{
			name:           "origins with whitespace",
			envValue:       " https://example.com , https://app.example.com , https://test.example.com ",
			expectedCount:  3,
			expectedOrigins: []string{"https://example.com", "https://app.example.com", "https://test.example.com"},
		},
		{
			name:           "empty ALLOWED_ORIGINS",
			envValue:       "",
			expectedCount:  0,
			expectedOrigins: []string{},
		},
		{
			name:           "comma-separated with empty strings",
			envValue:       "https://example.com,,,https://app.example.com",
			expectedCount:  2,
			expectedOrigins: []string{"https://example.com", "https://app.example.com"},
		},
		{
			name:           "only whitespace and commas",
			envValue:       " , , , ",
			expectedCount:  0,
			expectedOrigins: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Set environment variable
			os.Setenv("ALLOWED_ORIGINS", tt.envValue)
			defer os.Unsetenv("ALLOWED_ORIGINS")

			// Create handler
			handler := NewHandler()

			// Check count
			if len(handler.allowedOrigins) != tt.expectedCount {
				t.Errorf("expected %d origins, got %d", tt.expectedCount, len(handler.allowedOrigins))
			}

			// Check each origin
			for i, expected := range tt.expectedOrigins {
				if i >= len(handler.allowedOrigins) {
					t.Errorf("missing expected origin: %s", expected)
					continue
				}
				if handler.allowedOrigins[i] != expected {
					t.Errorf("expected origin[%d] = %s, got %s", i, expected, handler.allowedOrigins[i])
				}
			}
		})
	}
}

func TestSetHeaders(t *testing.T) {
	tests := []struct {
		name                  string
		allowedOrigins        []string
		requestOrigin         string
		expectedAllowed       bool
		expectedOriginHeader  string
		expectedCredsHeader   string
	}{
		{
			name:                 "allowed origin from single origin list",
			allowedOrigins:       []string{"https://example.com"},
			requestOrigin:        "https://example.com",
			expectedAllowed:      true,
			expectedOriginHeader: "https://example.com",
			expectedCredsHeader:  "true",
		},
		{
			name:                 "allowed origin from multiple origins",
			allowedOrigins:       []string{"https://example.com", "https://app.example.com"},
			requestOrigin:        "https://app.example.com",
			expectedAllowed:      true,
			expectedOriginHeader: "https://app.example.com",
			expectedCredsHeader:  "true",
		},
		{
			name:                 "disallowed origin",
			allowedOrigins:       []string{"https://example.com"},
			requestOrigin:        "https://evil.com",
			expectedAllowed:      false,
			expectedOriginHeader: "",
			expectedCredsHeader:  "",
		},
		{
			name:                 "empty origin list blocks all",
			allowedOrigins:       []string{},
			requestOrigin:        "https://example.com",
			expectedAllowed:      false,
			expectedOriginHeader: "",
			expectedCredsHeader:  "",
		},
		{
			name:                 "no origin header (same-origin request)",
			allowedOrigins:       []string{"https://example.com"},
			requestOrigin:        "",
			expectedAllowed:      true,
			expectedOriginHeader: "",
			expectedCredsHeader:  "",
		},
		{
			name:                 "exact match required (not substring)",
			allowedOrigins:       []string{"https://example.com"},
			requestOrigin:        "https://example.com.evil.com",
			expectedAllowed:      false,
			expectedOriginHeader: "",
			expectedCredsHeader:  "",
		},
		{
			name:                 "exact match required (not prefix)",
			allowedOrigins:       []string{"https://app.example.com"},
			requestOrigin:        "https://app.example.com.evil.com",
			expectedAllowed:      false,
			expectedOriginHeader: "",
			expectedCredsHeader:  "",
		},
		{
			name:                 "case sensitive origin matching",
			allowedOrigins:       []string{"https://example.com"},
			requestOrigin:        "https://Example.com",
			expectedAllowed:      false,
			expectedOriginHeader: "",
			expectedCredsHeader:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create handler with test origins
			handler := &Handler{
				allowedOrigins: tt.allowedOrigins,
			}

			// Create request and response
			req := httptest.NewRequest("GET", "/test", nil)
			if tt.requestOrigin != "" {
				req.Header.Set("Origin", tt.requestOrigin)
			}
			w := httptest.NewRecorder()

			// Call SetHeaders
			allowed := handler.SetHeaders(w, req)

			// Check return value
			if allowed != tt.expectedAllowed {
				t.Errorf("expected allowed=%v, got %v", tt.expectedAllowed, allowed)
			}

			// Check headers
			originHeader := w.Header().Get("Access-Control-Allow-Origin")
			if originHeader != tt.expectedOriginHeader {
				t.Errorf("expected Access-Control-Allow-Origin=%q, got %q", tt.expectedOriginHeader, originHeader)
			}

			credsHeader := w.Header().Get("Access-Control-Allow-Credentials")
			if credsHeader != tt.expectedCredsHeader {
				t.Errorf("expected Access-Control-Allow-Credentials=%q, got %q", tt.expectedCredsHeader, credsHeader)
			}
		})
	}
}

func TestHandlePreflight(t *testing.T) {
	tests := []struct {
		name                    string
		allowedOrigins          []string
		requestOrigin           string
		expectedStatus          int
		expectedOriginHeader    string
		expectedCredsHeader     string
		expectedMethodsHeader   string
		expectedHeadersHeader   string
		expectedMaxAgeHeader    string
	}{
		{
			name:                  "preflight with allowed origin",
			allowedOrigins:        []string{"https://example.com"},
			requestOrigin:         "https://example.com",
			expectedStatus:        http.StatusNoContent,
			expectedOriginHeader:  "https://example.com",
			expectedCredsHeader:   "true",
			expectedMethodsHeader: "GET, OPTIONS",
			expectedHeadersHeader: "Content-Type, Authorization",
			expectedMaxAgeHeader:  "3600",
		},
		{
			name:                  "preflight with disallowed origin",
			allowedOrigins:        []string{"https://example.com"},
			requestOrigin:         "https://evil.com",
			expectedStatus:        http.StatusNoContent,
			expectedOriginHeader:  "",
			expectedCredsHeader:   "",
			expectedMethodsHeader: "GET, OPTIONS",
			expectedHeadersHeader: "Content-Type, Authorization",
			expectedMaxAgeHeader:  "3600",
		},
		{
			name:                  "preflight without origin header",
			allowedOrigins:        []string{"https://example.com"},
			requestOrigin:         "",
			expectedStatus:        http.StatusNoContent,
			expectedOriginHeader:  "",
			expectedCredsHeader:   "",
			expectedMethodsHeader: "GET, OPTIONS",
			expectedHeadersHeader: "Content-Type, Authorization",
			expectedMaxAgeHeader:  "3600",
		},
		{
			name:                  "preflight with multiple allowed origins",
			allowedOrigins:        []string{"https://example.com", "https://app.example.com"},
			requestOrigin:         "https://app.example.com",
			expectedStatus:        http.StatusNoContent,
			expectedOriginHeader:  "https://app.example.com",
			expectedCredsHeader:   "true",
			expectedMethodsHeader: "GET, OPTIONS",
			expectedHeadersHeader: "Content-Type, Authorization",
			expectedMaxAgeHeader:  "3600",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create handler with test origins
			handler := &Handler{
				allowedOrigins: tt.allowedOrigins,
			}

			// Create request and response
			req := httptest.NewRequest("OPTIONS", "/test", nil)
			if tt.requestOrigin != "" {
				req.Header.Set("Origin", tt.requestOrigin)
			}
			w := httptest.NewRecorder()

			// Call HandlePreflight
			handler.HandlePreflight(w, req)

			// Check status code
			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			// Check all CORS headers
			originHeader := w.Header().Get("Access-Control-Allow-Origin")
			if originHeader != tt.expectedOriginHeader {
				t.Errorf("expected Access-Control-Allow-Origin=%q, got %q", tt.expectedOriginHeader, originHeader)
			}

			credsHeader := w.Header().Get("Access-Control-Allow-Credentials")
			if credsHeader != tt.expectedCredsHeader {
				t.Errorf("expected Access-Control-Allow-Credentials=%q, got %q", tt.expectedCredsHeader, credsHeader)
			}

			methodsHeader := w.Header().Get("Access-Control-Allow-Methods")
			if methodsHeader != tt.expectedMethodsHeader {
				t.Errorf("expected Access-Control-Allow-Methods=%q, got %q", tt.expectedMethodsHeader, methodsHeader)
			}

			headersHeader := w.Header().Get("Access-Control-Allow-Headers")
			if headersHeader != tt.expectedHeadersHeader {
				t.Errorf("expected Access-Control-Allow-Headers=%q, got %q", tt.expectedHeadersHeader, headersHeader)
			}

			maxAgeHeader := w.Header().Get("Access-Control-Max-Age")
			if maxAgeHeader != tt.expectedMaxAgeHeader {
				t.Errorf("expected Access-Control-Max-Age=%q, got %q", tt.expectedMaxAgeHeader, maxAgeHeader)
			}
		})
	}
}
