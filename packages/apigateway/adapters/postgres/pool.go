// Package postgres provides PostgreSQL adapter for hexagonal architecture.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool configuration defaults (can be overridden via environment variables).
// These are optimized for serverless environments like Cloud Run connecting to
// Neon's pooled endpoints (which have built-in PgBouncer). The low MaxConns
// setting works well with Neon's pooler since connection multiplexing happens
// server-side - we maintain few client connections while Neon efficiently
// shares database connections across all clients.
//
// Environment variables:
//   - DB_POOL_MAX_CONNS: Maximum connections (default: 5)
//   - DB_POOL_MIN_CONNS: Minimum connections to maintain (default: 0)
//   - DB_POOL_MAX_CONN_LIFETIME_MINUTES: Connection refresh interval (default: 30)
//   - DB_POOL_MAX_CONN_IDLE_MINUTES: Idle connection timeout (default: 5)
//   - DB_POOL_HEALTH_CHECK_MINUTES: Health check interval (default: 1)
//   - DB_SLOW_QUERY_THRESHOLD_MS: Slow-query WARN log threshold in ms
//     (default: 500). Set to 0 to disable per-query slow logging entirely.
//
// Note: MinConns must be <= MaxConns. pgxpool handles violations gracefully
// (caps at MaxConns) but we validate early for clearer error messages.
const (
	defaultMaxConns             = 5                // Low max for Cloud Run + Neon pooler
	defaultMinConns             = 0                // Scale to zero when idle
	defaultMaxConnLifetime      = 30 * time.Minute // Refresh connections periodically
	defaultMaxConnIdleTime      = 5 * time.Minute  // Release idle connections quickly
	defaultHealthCheckPeriod    = 1 * time.Minute
	defaultSlowQueryThresholdMs = 500 // Matches existing P99 OTel histogram alert threshold
)

// Sentinel errors for connection string and pool configuration validation.
var (
	// ErrMissingApplicationName indicates connection string is missing required application_name parameter.
	ErrMissingApplicationName = errors.New(
		"connection string must include 'application_name' parameter for observability")

	// ErrInvalidScheme indicates connection string has wrong URL scheme.
	ErrInvalidScheme = errors.New(
		"connection string must use 'postgresql' scheme")

	// ErrInvalidPoolConfig indicates pool configuration is invalid (e.g., MinConns > MaxConns).
	ErrInvalidPoolConfig = errors.New(
		"invalid pool configuration: DB_POOL_MIN_CONNS must be <= DB_POOL_MAX_CONNS")
)

// Pool wraps pgxpool.Pool for connection management.
// For pool statistics, use the embedded Pool.Stat() method directly.
type Pool struct {
	*pgxpool.Pool
}

// NewPool creates a PostgreSQL connection pool optimized for serverless environments.
// Connection string must be provided by the caller.
// Validates that application_name is present for observability.
func NewPool(ctx context.Context, connString string, logger *slog.Logger) (*Pool, error) {
	// Validate connection string format and required parameters
	if validateErr := validateConnectionString(connString); validateErr != nil {
		return nil, validateErr
	}

	config, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("parse connection string: %w", err)
	}

	// Serverless-friendly pool settings (configurable via environment variables)
	config.MaxConns = getInt32Env("DB_POOL_MAX_CONNS", defaultMaxConns)
	config.MinConns = getInt32Env("DB_POOL_MIN_CONNS", defaultMinConns)
	config.MaxConnLifetime = getDurationEnvMinutes("DB_POOL_MAX_CONN_LIFETIME_MINUTES", defaultMaxConnLifetime)
	config.MaxConnIdleTime = getDurationEnvMinutes("DB_POOL_MAX_CONN_IDLE_MINUTES", defaultMaxConnIdleTime)
	config.HealthCheckPeriod = getDurationEnvMinutes("DB_POOL_HEALTH_CHECK_MINUTES", defaultHealthCheckPeriod)

	// Validate pool configuration - pgxpool handles this gracefully (caps at MaxConns)
	// but we fail early with a clear error message for easier debugging.
	if config.MinConns > config.MaxConns {
		return nil, fmt.Errorf("%w: min=%d, max=%d", ErrInvalidPoolConfig, config.MinConns, config.MaxConns)
	}

	// Slow-query logging via pgx tracer. Threshold is configurable via
	// DB_SLOW_QUERY_THRESHOLD_MS; setting it to 0 disables the tracer
	// entirely (no per-query overhead, no log lines).
	slowMs := getInt32Env("DB_SLOW_QUERY_THRESHOLD_MS", defaultSlowQueryThresholdMs)
	if slowMs > 0 {
		config.ConnConfig.Tracer = newSlowQueryTracer(
			logger,
			time.Duration(slowMs)*time.Millisecond,
		)
	}

	logger.Info("Creating PostgreSQL connection pool",
		"max_conns", config.MaxConns,
		"min_conns", config.MinConns,
		"slow_query_threshold_ms", slowMs,
	)

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	// Verify connectivity
	if pingErr := pool.Ping(ctx); pingErr != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", pingErr)
	}

	logger.Info("PostgreSQL connection pool established")

	return &Pool{Pool: pool}, nil
}

// validateConnectionString validates application-specific connection string requirements.
// pgxpool.ParseConfig() handles standard validation (host, port, database, credentials),
// so we only check requirements that pgx doesn't enforce:
// - Valid URL syntax
// - postgresql:// scheme (not mysql://, etc.)
// - application_name parameter for observability (pg_stat_activity, Neon logs)
func validateConnectionString(connString string) error {
	parsed, err := url.Parse(connString)
	if err != nil {
		return fmt.Errorf("invalid connection string URL: %w", err)
	}

	// Validate scheme - must be postgresql (pgx doesn't use +driver suffix)
	if parsed.Scheme != "postgresql" {
		return fmt.Errorf("%w: got %q", ErrInvalidScheme, parsed.Scheme)
	}

	// Validate application_name is present for observability
	if parsed.Query().Get("application_name") == "" {
		return ErrMissingApplicationName
	}

	return nil
}

// getInt32Env reads an int32 from environment variable.
// Returns defaultValue if the environment variable is not set or invalid.
func getInt32Env(key string, defaultValue int32) int32 {
	if value := os.Getenv(key); value != "" {
		i, err := strconv.ParseInt(value, 10, 32)
		if err == nil && i >= 0 {
			return int32(i)
		}
		if err != nil {
			// #nosec G706 - environment variable values are logged for configuration debugging.
			slog.Warn("Invalid environment variable value, using default", "key", key, "value", value, "error", err)
		} else {
			// #nosec G706 - environment variable values are logged for configuration debugging.
			slog.Warn("Invalid environment variable value (must be non-negative), using default", "key", key, "value", value)
		}
	}
	return defaultValue
}

// getDurationEnvMinutes reads a duration (in minutes) from environment variable.
// Returns defaultValue if the environment variable is not set or invalid.
func getDurationEnvMinutes(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		minutes, err := strconv.Atoi(value)
		if err == nil && minutes > 0 {
			return time.Duration(minutes) * time.Minute
		}
		if err != nil {
			// #nosec G706 - environment variable values are logged for configuration debugging.
			slog.Warn("Invalid environment variable value, using default", "key", key, "value", value, "error", err)
		} else {
			// #nosec G706 - environment variable values are logged for configuration debugging.
			slog.Warn("Invalid environment variable value (must be positive), using default", "key", key, "value", value)
		}
	}
	return defaultValue
}
