package config

// Secret file paths for Cloud Run volume-mounted secrets.
// All secret paths are consolidated here for auditability.
// In local development, each has an environment variable fallback
// (handled by the adapter that reads it).
const (
	// Webhook verification secrets (used by env/SecretCache)

	// SecretPathVerifyToken is the path to the webhook verify token secret file.
	SecretPathVerifyToken = "/etc/secrets/INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN/value" //nolint:gosec // Path, not credential
	// SecretPathSubscriptionID is the path to the subscription ID secret file.
	SecretPathSubscriptionID = "/etc/secrets/INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID/value" //nolint:gosec // Path, not credential

	// Strava API secrets (used by strava/Client)

	// SecretPathStravaClientID is the path to the Strava client ID secret.
	SecretPathStravaClientID = "/etc/secrets/INFISICAL_STRAVA_CLIENT_ID/value" //nolint:gosec // Path, not credential
	// SecretPathStravaClientSecret is the path to the Strava client secret.
	SecretPathStravaClientSecret = "/etc/secrets/INFISICAL_STRAVA_CLIENT_SECRET/value" //nolint:gosec // Path, not credential
	// SecretPathStravaRefreshToken is the path to the Strava refresh token secret.
	SecretPathStravaRefreshToken = "/etc/secrets/INFISICAL_STRAVA_REFRESH_TOKEN/value" //nolint:gosec // Path, not credential
)
