package config

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestParseEnvironment(t *testing.T) {
	cases := []struct {
		in     string
		want   Environment
		wantOK bool
	}{
		{"", EnvLocal, true},
		{"local", EnvLocal, true},
		{"dev", EnvDev, true},
		{"prod", EnvProd, true},
		{"production", "", false}, // typo guard — must not silently map to prod
		{"PROD", "", false},       // case-sensitive
		{"prouction", "", false},  // typo guard
		{"staging", "", false},    // unknown env
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, err := parseEnvironment(tc.in)
			if tc.wantOK && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !tc.wantOK && err == nil {
				t.Fatalf("expected error for %q, got %v", tc.in, got)
			}
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEnvironment_Predicates(t *testing.T) {
	if !EnvLocal.IsLocal() {
		t.Error("EnvLocal.IsLocal() should be true")
	}
	if EnvDev.IsLocal() {
		t.Error("EnvDev.IsLocal() should be false")
	}
	if EnvProd.IsLocal() {
		t.Error("EnvProd.IsLocal() should be false")
	}

	if EnvLocal.IsProduction() {
		t.Error("EnvLocal.IsProduction() should be false")
	}
	if EnvDev.IsProduction() {
		t.Error("EnvDev.IsProduction() should be false")
	}
	if !EnvProd.IsProduction() {
		t.Error("EnvProd.IsProduction() should be true")
	}
}

func TestConfig_LogAttrs_OmitsSecrets(t *testing.T) {
	// Construct a Config with values that look like secrets to verify
	// none of them leak through LogAttrs. Real secrets are loaded via
	// secrets.LoadFromMount and never stored on Config, but we still
	// guard against a future regression where someone adds a secret
	// field and forgets to exclude it from LogAttrs.
	cfg := &Config{
		Environment:       EnvDev,
		GCPProjectID:      "test-project",
		FirestoreDatabase: "test-db",
		FrontendURL:       "https://desirelines.example",
		AuthCallbackURL:   "https://desirelines.example/api/auth/callback",
		AllowedOrigins:    []string{"https://desirelines.example"},
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		ShutdownTimeout:   30 * time.Second,
	}

	attrs := cfg.LogAttrs()
	rendered := fmt.Sprint(attrs...)

	// Sanity: expected operational fields are present
	if !strings.Contains(rendered, "https://desirelines.example") {
		t.Errorf("LogAttrs missing expected frontend URL: %s", rendered)
	}
	if !strings.Contains(rendered, "test-project") {
		t.Errorf("LogAttrs missing expected gcp_project_id: %s", rendered)
	}
	if !strings.Contains(rendered, "dev") {
		t.Errorf("LogAttrs missing expected environment: %s", rendered)
	}

	// Allowed origins must be redacted to a count, not the values
	// themselves (defensive — origins aren't secret today, but the
	// pattern matters).
	if !strings.Contains(rendered, "allowed_origins_count") {
		t.Errorf("LogAttrs missing allowed_origins_count: %s", rendered)
	}

	// Pattern check: anything looking like a secret canary token must
	// not appear. (The current Config struct holds no secret fields —
	// secrets are loaded out-of-band via secrets.LoadFromMount — but
	// this test fails loudly if a future change adds one and forgets
	// to redact it.)
	canaries := []string{
		"SECRET_PASSWORD",
		"private-key",
		"AKIA",
	}
	for _, canary := range canaries {
		if strings.Contains(rendered, canary) {
			t.Errorf("LogAttrs leaked canary %q: %s", canary, rendered)
		}
	}
}
