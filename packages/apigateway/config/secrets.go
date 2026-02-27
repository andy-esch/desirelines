package config

// Secret file paths for Cloud Run volume-mounted secrets.
// All secret paths are consolidated here for auditability.
// In local development, each has an environment variable fallback
// (handled by secrets.LoadFromMount at the call site).
const (
	// Strava OAuth secrets (used by auth handler)

	// SecretPathStravaClientID is the path to the Strava client ID secret.
	SecretPathStravaClientID = "/etc/secrets/INFISICAL_STRAVA_CLIENT_ID/value" //nolint:gosec // Path, not credential
	// SecretPathStravaClientSecret is the path to the Strava client secret.
	SecretPathStravaClientSecret = "/etc/secrets/INFISICAL_STRAVA_CLIENT_SECRET/value" //nolint:gosec // Path, not credential
	// SecretPathAuthStateSecret is the path to the OAuth state signing secret.
	SecretPathAuthStateSecret = "/etc/secrets/INFISICAL_AUTH_STATE_SECRET/value" //nolint:gosec // Path, not credential

	// Database secrets

	// SecretPathPostgresConn is the path to the PostgreSQL connection string secret.
	SecretPathPostgresConn = "/etc/secrets/INFISICAL_POSTGRES_CONN_APIGATEWAY/value" //nolint:gosec // Path, not credential
)
