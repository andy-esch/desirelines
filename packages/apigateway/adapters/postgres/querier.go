package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DBQuerier is the common interface satisfied by both pgxpool.Pool and pgx.Tx.
// This allows the repository to run queries against either a real connection pool
// (production) or a transaction (tests with rollback isolation).
type DBQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// rowScanner is the minimal pgx.Rows subset the multi-sport scan helpers
// consume. Kept narrow so tests can supply a fake row source (see the
// emptyRows fake in activities_test.go); *pgx.Rows satisfies it in production.
type rowScanner interface {
	Next() bool
	Scan(dest ...interface{}) error
	Err() error
}
