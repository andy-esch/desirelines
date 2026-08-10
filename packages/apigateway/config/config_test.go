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
		ShutdownTimeout:   8 * time.Second,
		ReadinessTimeout:  10 * time.Second,
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

// The two shutdown phases run one after the other, so the invariant that
// matters is that their sum never exceeds the configured total — that sum is
// what has to fit inside Cloud Run's termination grace period.
func TestConfig_ShutdownBudgets(t *testing.T) {
	t.Run("splits the default budget with the drain taking the larger share", func(t *testing.T) {
		c := &Config{ShutdownTimeout: DefaultShutdownTimeout}
		drain, flush := c.ShutdownBudgets()

		if drain+flush != DefaultShutdownTimeout {
			t.Errorf("drain+flush = %v, want exactly %v", drain+flush, DefaultShutdownTimeout)
		}
		if drain <= flush {
			t.Errorf("drain = %v, flush = %v; drain should get the larger share", drain, flush)
		}
		if flush <= 0 {
			t.Errorf("flush = %v; the telemetry flush must get a non-zero budget", flush)
		}
	})

	t.Run("default total fits inside Cloud Run's 10s termination grace", func(t *testing.T) {
		// The regression this guards: both phases previously used the full
		// 30s ShutdownTimeout, so shutdown could run 60s against a 10s grace
		// and the flush was always SIGKILLed.
		const cloudRunGracePeriod = 10 * time.Second
		if DefaultShutdownTimeout >= cloudRunGracePeriod {
			t.Errorf("DefaultShutdownTimeout = %v, must be under the %v grace period",
				DefaultShutdownTimeout, cloudRunGracePeriod)
		}
	})

	t.Run("sum is preserved for arbitrary totals", func(t *testing.T) {
		for _, total := range []time.Duration{
			0, time.Second, 3 * time.Second, 8 * time.Second, 30 * time.Second,
		} {
			c := &Config{ShutdownTimeout: total}
			drain, flush := c.ShutdownBudgets()
			if drain+flush != total {
				t.Errorf("total %v: drain+flush = %v, want %v", total, drain+flush, total)
			}
			if drain < 0 || flush < 0 {
				t.Errorf("total %v: negative budget drain=%v flush=%v", total, drain, flush)
			}
		}
	})
}
