# 01. Repository & Query Layer Hardening

> **Goal:** Make the data-access layer boring. Replace the hand-rolled query construction, give every query a timeout and a slow-log warning, and lock down the few places where SQL is built from formatted strings.

This is the largest code-quality lift in the package. None of it is urgent — the current code works and is parameterized — but the cumulative effect on maintainability and operational visibility is significant.

## Why it matters

`adapters/postgres/activities.go` is the busiest file in the package and the one most likely to grow new queries as features land. Today it has:

- A custom `queryBuilder` with `panic()` on misuse.
- Date-range filters built via `fmt.Sprintf("%d-01-01", year)`.
- Pagination via base64 cursor with no length validation on the decoded payload.
- Query duration recorded to OTel histograms but no slow-query *logs* — a 9.9-second query completes silently.
- No transaction usage even where multi-step operations would benefit.

Each of these is fine in isolation. Together they're a footgun aimed at whichever future change touches this file.

## Current state (specific findings)

- `adapters/postgres/activities.go:497–515` — `queryBuilder.AddCondition` uses `fmt.Sprintf(format, indices...)` to inject `$1, $2` placeholders. Clever but fragile: any unintended `%d` in a comment or label would silently break.
- `adapters/postgres/activities.go:502–503` — `panic()` on placeholder/arg mismatch. Compile-time bug → production crash.
- `adapters/postgres/activities.go:191–199` — `getDateRangeForYear()` builds `"%d-01-01"` strings for SQL date bounds. Year is validated (2000–2050) so it's safe today, but the pattern invites copy-paste regressions.
- `adapters/postgres/activities.go:36–48` — `start_date_local::date` cast, comment correctly explains "no UTC conversion." Documentation is good but the invariant only lives in a comment.
- `internal/activities/handler.go:704–737` — `decodeCursor` validates parsed timestamp + ID but not the decoded string length. Base64 input is capped at 100 chars (`MaxCursorLength`) but the decoded payload (e.g., a 1000-zero timestamp) isn't bounded.
- No `log_min_duration_statement` equivalent in app code — slow queries are histogrammed but never alerted.

## Concrete steps

### 1. Replace `queryBuilder` with [Squirrel](https://github.com/Masterminds/squirrel) or pgx-native composition

Squirrel is ~600 lines and does this job correctly:

```go
sb := squirrel.Select("id", "name", "distance").
    From("activities").
    Where(squirrel.Eq{"user_id": userID}).
    PlaceholderFormat(squirrel.Dollar)

if year != 0 {
    sb = sb.Where("EXTRACT(YEAR FROM start_date_local) = ?", year)
}
sql, args, err := sb.ToSql()
```

No panics, no Sprintf, type-safe. Replace `queryBuilder` in `activities.go` over 2–3 PRs (one query at a time, run integration tests between).

If Squirrel feels heavy, pgx-native string concatenation with explicit `args = append(args, x); placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))` is fine — just delete the `queryBuilder` indirection.

### 2. Parameterize date-range filters

Replace `fmt.Sprintf("%d-01-01", year)` with a parameterized PostgreSQL expression:

```go
// Instead of:
//   WHERE start_date_local >= '2024-01-01' AND start_date_local < '2025-01-01'
// Do:
//   WHERE EXTRACT(YEAR FROM start_date_local) = $1
sb = sb.Where("EXTRACT(YEAR FROM start_date_local) = ?", year)
```

This eliminates one fmt.Sprintf, makes the index plan explicit (you'll want a functional index on `EXTRACT(YEAR FROM start_date_local)` if it isn't there — check via `EXPLAIN ANALYZE` per project [#4 Performance](../04-performance.md) step 2), and removes the implicit string-format-as-SQL pattern.

### 3. Slow-query logging in pgx

pgx's `tracelog.TraceLog` lets you log queries that exceed a threshold. In `adapters/postgres/pool.go`, attach a tracer:

```go
config.ConnConfig.Tracer = &tracelog.TraceLog{
    Logger:   pgxLogger,                  // adapter to slog
    LogLevel: tracelog.LogLevelWarn,
}
```

Then customize so only queries over (say) 500ms log at WARN with the SQL text and args. Tie this into project [#1 Observability](../01-observability.md) — set an alert on slow-query log volume.

### 4. Bound the decoded cursor

In `internal/activities/handler.go:704`, after base64 decoding, check the *decoded* length:

```go
if len(decoded) > MaxCursorDecodedLength { // e.g., 64
    return nil, fmt.Errorf("cursor too long")
}
```

Cheap, defensive, no functional change for legitimate clients.

### 5. Replace `panic()` in `queryBuilder` with returned errors

If you keep `queryBuilder` (i.e. don't do step 1), at minimum:

```go
func (qb *queryBuilder) AddCondition(...) error {
    if mismatched { return fmt.Errorf("placeholder count mismatch") }
    ...
}
```

A panic-free package is one less thing the panic-recovery middleware (project [#2 Security](../02-security.md) step 5) has to catch.

### 6. Use transactions where the operation is multi-step

`internal/auth/handler.go:174–208` writes Strava tokens to Firestore *and* syncs the Firebase profile. The current behavior treats the second write as best-effort (logs the failure, returns success). That's defensible — but document it explicitly:

```go
// WriteAuthData is the commit point. syncFirebaseProfile is fire-and-forget;
// failures here are logged but do not unwind the token write.
```

For any *new* multi-step DB operation, use `pgx.BeginTx` + `tx.Commit()`/`tx.Rollback()` rather than ad-hoc multi-write sequences.

### 7. Move the `start_date_local` invariant out of comments

The "TIMESTAMP WITHOUT TIME ZONE — never convert to UTC" rule lives only in a Go comment at `activities.go:36`. Reinforce it where it matters:

- Add a `COMMENT ON COLUMN desirelines.activities.start_date_local IS '...'` migration.
- Add a unit test that calls `GetActivitiesByDateRange` for a date crossing midnight UTC and asserts the row is included based on local time, not UTC.

A comment in the schema and a regression test together survive refactors that delete Go comments.

## What to skip

- **Don't** introduce an ORM. pgx + Squirrel (or pgx alone) is the right level for this codebase.
- **Don't** rewrite all queries at once. One PR per query keeps integration-test signal clean.
- **Don't** chase JSON encoder micro-optimizations until the slow-query log is empty for a month.

## References

- Masterminds/squirrel: https://github.com/Masterminds/squirrel
- pgx tracelog: https://pkg.go.dev/github.com/jackc/pgx/v5/tracelog
- PostgreSQL `EXPLAIN ANALYZE` reference: https://www.postgresql.org/docs/current/sql-explain.html
- "Use The Index, Luke" (functional indexes): https://use-the-index-luke.com/sql/where-clause/functions
- pgx pool config (`Tracer` field): https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool
- "Don't use panic() in libraries" — Go proverb (Rob Pike, "Errors are values"): https://go.dev/blog/errors-are-values
