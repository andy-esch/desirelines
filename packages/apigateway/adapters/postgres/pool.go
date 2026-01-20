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
// These are optimized for serverless environments like Cloud Run.
const (
	defaultMaxConns          = 5                // Low max for Cloud Run (1 concurrent request by default)
	defaultMinConns          = 0                // Scale to zero when idle
	defaultMaxConnLifetime   = 30 * time.Minute // Refresh connections periodically
	defaultMaxConnIdleTime   = 5 * time.Minute  // Release idle connections quickly
	defaultHealthCheckPeriod = 1 * time.Minute
)

// Sentinel errors for connection string validation.
var (
	// ErrMissingApplicationName indicates connection string is missing required application_name parameter.
	ErrMissingApplicationName = errors.New(
		"connection string must include 'application_name' parameter for observability")

	// ErrInvalidScheme indicates connection string has wrong URL scheme.
	ErrInvalidScheme = errors.New(
		"connection string must use 'postgresql' scheme")
)

// Pool wraps pgxpool.Pool for connection management.
type Pool struct {
	*pgxpool.Pool
}

// PoolStats contains connection pool statistics for monitoring and diagnostics.
type PoolStats struct {
	// AcquireCount is the cumulative count of successful acquires from the pool.
	AcquireCount int64
	// AcquireDuration is the total duration of all successful acquires.
	AcquireDuration time.Duration
	// AcquiredConns is the number of currently acquired connections.
	AcquiredConns int32
	// CanceledAcquireCount is the cumulative count of acquires canceled by context.
	CanceledAcquireCount int64
	// EmptyAcquireCount is the cumulative count of acquires that waited for a connection
	// because the pool was empty.
	EmptyAcquireCount int64
	// IdleConns is the number of currently idle connections.
	IdleConns int32
	// MaxConns is the maximum size of the pool.
	MaxConns int32
	// TotalConns is the total number of connections currently in the pool.
	TotalConns int32
	// NewConnsCount is the cumulative count of new connections opened.
	NewConnsCount int64
	// MaxLifetimeDestroyCount is the cumulative count of connections destroyed due to MaxConnLifetime.
	MaxLifetimeDestroyCount int64
	// MaxIdleDestroyCount is the cumulative count of connections destroyed due to MaxConnIdleTime.
	MaxIdleDestroyCount int64
}

// Stats returns current connection pool statistics for monitoring.
// Use this to diagnose connection issues and tune pool settings.
func (p *Pool) Stats() PoolStats {
	s := p.Pool.Stat()
	return PoolStats{
		AcquireCount:            s.AcquireCount(),
		AcquireDuration:         s.AcquireDuration(),
		AcquiredConns:           s.AcquiredConns(),
		CanceledAcquireCount:    s.CanceledAcquireCount(),
		EmptyAcquireCount:       s.EmptyAcquireCount(),
		IdleConns:               s.IdleConns(),
		MaxConns:                s.MaxConns(),
		TotalConns:              s.TotalConns(),
		NewConnsCount:           s.NewConnsCount(),
		MaxLifetimeDestroyCount: s.MaxLifetimeDestroyCount(),
		MaxIdleDestroyCount:     s.MaxIdleDestroyCount(),
	}
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
	config.MaxConns = int32(getIntEnv("DB_POOL_MAX_CONNS", defaultMaxConns))
	config.MinConns = int32(getIntEnv("DB_POOL_MIN_CONNS", defaultMinConns))
	config.MaxConnLifetime = getDurationEnvMinutes("DB_POOL_MAX_CONN_LIFETIME_MINUTES", defaultMaxConnLifetime)
	config.MaxConnIdleTime = getDurationEnvMinutes("DB_POOL_MAX_CONN_IDLE_MINUTES", defaultMaxConnIdleTime)
	config.HealthCheckPeriod = getDurationEnvMinutes("DB_POOL_HEALTH_CHECK_MINUTES", defaultHealthCheckPeriod)

	logger.Info("Creating PostgreSQL connection pool",
		"max_conns", config.MaxConns,
		"min_conns", config.MinConns,
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

// validateConnectionString validates the connection string has required elements:
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

// getIntEnv reads an integer from environment variable.
// Returns defaultValue if the environment variable is not set or invalid.
func getIntEnv(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil && i >= 0 {
			return i
		}
	}
	return defaultValue
}

// getDurationEnvMinutes reads a duration (in minutes) from environment variable.
// Returns defaultValue if the environment variable is not set or invalid.
func getDurationEnvMinutes(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if minutes, err := strconv.Atoi(value); err == nil && minutes > 0 {
			return time.Duration(minutes) * time.Minute
		}
	}
	return defaultValue
}
