package postgres

// NewTestActivityRepository creates a repository backed by any DBQuerier.
// Exported for use in integration tests (postgres_test package).
var NewTestActivityRepository = newActivityRepository
