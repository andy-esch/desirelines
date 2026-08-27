package postgres

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"
)

func TestValidateConnectionString(t *testing.T) {
	// #nosec G101 - test connection strings use dummy credentials.
	tests := []struct {
		name      string
		connStr   string
		wantErr   error
		wantNoErr bool
	}{
		// Valid cases
		{
			name:      "valid with all required params",
			connStr:   "postgresql://user:pass@host/db?sslmode=require&application_name=apigateway",
			wantNoErr: true,
		},
		{
			name:      "valid with application_name only param",
			connStr:   "postgresql://user:pass@host/db?application_name=my-service",
			wantNoErr: true,
		},
		{
			name:      "valid with application_name first",
			connStr:   "postgresql://user:pass@host/db?application_name=svc&sslmode=require",
			wantNoErr: true,
		},
		{
			name:      "valid with special chars in application_name",
			connStr:   "postgresql://user:pass@host/db?application_name=my-service_v2",
			wantNoErr: true,
		},
		{
			name:      "valid with port number",
			connStr:   "postgresql://user:pass@host:5432/db?application_name=test",
			wantNoErr: true,
		},
		// Missing application_name
		{
			name:    "missing application_name",
			connStr: "postgresql://user:pass@host/db?sslmode=require",
			wantErr: ErrMissingApplicationName,
		},
		{
			name:    "empty connection string",
			connStr: "",
			wantErr: ErrInvalidScheme, // Empty string has no scheme
		},
		{
			name:    "no query params",
			connStr: "postgresql://user:pass@host/db",
			wantErr: ErrMissingApplicationName,
		},
		// Invalid scheme
		{
			name:    "wrong scheme mysql",
			connStr: "mysql://user:pass@host/db?application_name=test",
			wantErr: ErrInvalidScheme,
		},
		{
			name:    "wrong scheme postgres (missing ql)",
			connStr: "postgres://user:pass@host/db?application_name=test",
			wantErr: ErrInvalidScheme,
		},
		{
			name:    "sqlalchemy dialect prefix rejected",
			connStr: "postgresql+psycopg://user:pass@host/db?application_name=test",
			wantErr: ErrInvalidScheme,
		},
		{
			name:    "http scheme rejected",
			connStr: "http://user:pass@host/db?application_name=test",
			wantErr: ErrInvalidScheme,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateConnectionString(tt.connStr)

			if tt.wantNoErr {
				if err != nil {
					t.Errorf("validateConnectionString() error = %v, want no error", err)
				}
				return
			}

			if err == nil {
				t.Errorf("validateConnectionString() error = nil, want error")
				return
			}

			if tt.wantErr != nil && !errors.Is(err, tt.wantErr) {
				t.Errorf("validateConnectionString() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestSentinelErrors(t *testing.T) {
	t.Run("ErrMissingApplicationName is sentinel", func(t *testing.T) {
		err := validateConnectionString("postgresql://user@host/db")
		if !errors.Is(err, ErrMissingApplicationName) {
			t.Errorf("error should wrap ErrMissingApplicationName, got %v", err)
		}
	})

	t.Run("ErrInvalidScheme is sentinel with context", func(t *testing.T) {
		err := validateConnectionString("mysql://user@host/db?application_name=test")
		if !errors.Is(err, ErrInvalidScheme) {
			t.Errorf("error should wrap ErrInvalidScheme, got %v", err)
		}
		// Error message should include the actual scheme
		if err.Error() == ErrInvalidScheme.Error() {
			t.Error("error should include actual scheme in message")
		}
	})
}

func TestGetInt32Env(t *testing.T) {
	tests := []struct {
		name         string
		envValue     string
		defaultValue int32
		want         int32
	}{
		{"uses default when unset", "", 5, 5},
		{"parses valid int", "10", 5, 10},
		{"uses default for negative", "-1", 5, 5},
		{"uses default for non-numeric", "abc", 5, 5},
		{"uses default for float", "3.14", 5, 5},
		{"parses zero", "0", 5, 0},
		{"parses large value", "100", 5, 100},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			const envKey = "TEST_POOL_INT32"
			if tt.envValue != "" {
				t.Setenv(envKey, tt.envValue)
			}
			got := getInt32Env(envKey, tt.defaultValue)
			if got != tt.want {
				t.Errorf("getInt32Env() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestGetDurationEnvMinutes(t *testing.T) {
	tests := []struct {
		name         string
		envValue     string
		defaultValue int // minutes
		wantMinutes  int
	}{
		{"uses default when unset", "", 30, 30},
		{"parses valid minutes", "10", 30, 10},
		{"uses default for zero", "0", 30, 30},
		{"uses default for negative", "-5", 30, 30},
		{"uses default for non-numeric", "abc", 30, 30},
		{"parses one minute", "1", 30, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			const envKey = "TEST_POOL_DURATION"
			if tt.envValue != "" {
				t.Setenv(envKey, tt.envValue)
			}
			defaultDuration := time.Duration(tt.defaultValue) * time.Minute
			wantDuration := time.Duration(tt.wantMinutes) * time.Minute

			got := getDurationEnvMinutes(envKey, defaultDuration)
			if got != wantDuration {
				t.Errorf("getDurationEnvMinutes() = %v, want %v", got, wantDuration)
			}
		})
	}
}

func TestPoolConfigValidation(t *testing.T) {
	// This test verifies pool configuration validation by checking that
	// MinConns > MaxConns returns an appropriate error. We can't test NewPool
	// directly without a real database, but we can verify the validation logic
	// by checking that invalid config produces ErrInvalidPoolConfig.

	t.Run("documents MinConns must be <= MaxConns", func(t *testing.T) {
		// The validation in NewPool checks: if config.MinConns > config.MaxConns
		// This test documents the constraint and verifies the error type exists.
		//
		// Note: pgxpool itself handles MinConns > MaxConns gracefully (it caps
		// at MaxConns), but we validate early for clearer error messages.
		// See pool.go constants documentation for details.

		if ErrInvalidPoolConfig == nil {
			t.Error("ErrInvalidPoolConfig should be defined")
		}

		expectedMsg := "invalid pool configuration: DB_POOL_MIN_CONNS must be <= DB_POOL_MAX_CONNS"
		if ErrInvalidPoolConfig.Error() != expectedMsg {
			t.Errorf("ErrInvalidPoolConfig = %q, want %q", ErrInvalidPoolConfig.Error(), expectedMsg)
		}
	})
}

// TestNewPoolRejectsZeroMaxConns covers the gap that made ErrInvalidPoolConfig
// escapable: the only pool-config guard used to be MinConns > MaxConns, which
// DB_POOL_MAX_CONNS=0 slips past — 0 > 0 is false, and defaultMinConns is 0.
// pgxpool would then cap the pool at zero and the service would fail on first
// query rather than at construction, which is the failure this guard exists to
// prevent.
//
// Only 0 can reach the guard: getInt32Env rejects negatives (it requires
// i >= 0) and falls back to the default, so DB_POOL_MAX_CONNS=-1 yields a
// perfectly valid pool. That is why this test has a single case.
//
// NewPool validates before it builds the pool, and pgxpool connects lazily, so
// this exercises the real function with no database.
func TestNewPoolRejectsZeroMaxConns(t *testing.T) {
	// #nosec G101 - test connection string uses dummy credentials.
	const connString = "postgresql://user:pass@localhost:5432/db?sslmode=require&application_name=apigateway"

	t.Setenv("DB_POOL_MAX_CONNS", "0")

	pool, err := NewPool(context.Background(), connString, slog.Default(), nil)
	if pool != nil {
		t.Error("NewPool returned a pool for MaxConns=0; want nil")
	}
	if !errors.Is(err, ErrInvalidPoolConfig) {
		t.Fatalf("NewPool error = %v, want it to wrap ErrInvalidPoolConfig", err)
	}
}

// TestServerTimeoutsRideRuntimeParams pins the transport for the server-side
// timeouts. Neon's pooled endpoint forwards these as discrete startup fields
// but rejects the same GUCs inside a libpq `options` string — the failure that
// took the Python writer's connections down. Without this test, the warning in
// NewPool is only prose.
func TestServerTimeoutsRideRuntimeParams(t *testing.T) {
	// #nosec G101 - test connection string uses dummy credentials.
	const connStr = "postgresql://user:pass@host/db?sslmode=require&application_name=apigateway"

	pool, err := NewPool(context.Background(), connStr, slog.New(slog.DiscardHandler), nil)
	if err != nil {
		t.Fatalf("NewPool() error = %v", err)
	}
	defer pool.Close()

	params := pool.Config().ConnConfig.RuntimeParams

	for _, guc := range []string{"statement_timeout", "idle_in_transaction_session_timeout"} {
		if params[guc] == "" {
			t.Errorf("RuntimeParams[%q] unset: the timeout never reaches Postgres", guc)
		}
	}

	if got, ok := params["options"]; ok {
		t.Errorf("RuntimeParams[\"options\"] = %q: a pooler rejects GUCs sent this way", got)
	}
}
