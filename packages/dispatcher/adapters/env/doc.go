// Package env provides adapters for loading configuration and secrets from the environment and filesystem.
//
// This adapter implements [ports.SecretProvider] to retrieve Strava webhook
// verification secrets from mounted secret files (typical in Cloud Run/Kubernetes).
//
// # Basic Usage
//
//	secretProvider := env.NewDefaultSecretCache(logger)
//	verifyToken, subscriptionID, err := secretProvider.GetSecrets()
//
// # Atomic Secret Files
//
// Secrets are mounted as individual files (atomic mounts):
//
//	/etc/secrets/INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN/value
//	/etc/secrets/INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID/value
//
// This replaces the previous JSON blob approach and provides:
//   - Granular access control per secret
//   - Independent rotation of individual secrets
//   - Simpler code (no JSON parsing)
//
// # Environment Variable Fallback
//
// For local development, secrets can be provided via environment variables:
//
//	STRAVA_WEBHOOK_VERIFY_TOKEN=your-token
//	STRAVA_WEBHOOK_SUBSCRIPTION_ID=12345
//
// # Caching
//
// [SecretCache] provides TTL-based caching with content-hash validation:
//   - Secrets are cached for 5 minutes by default
//   - On cache expiry, files are re-read only if content hash changed
//   - Enables secret rotation without service restart
//
// Example with custom TTL:
//
//	cache := env.NewSecretCache(verifyTokenPath, subscriptionIDPath, 1*time.Minute, logger)
//
// # Thread Safety
//
// [SecretCache] is safe for concurrent use. Multiple goroutines may call
// GetSecrets simultaneously.
//
// # Cloud Run Integration
//
// In Cloud Run, secrets are mounted automatically via Terraform configuration.
// The secret values are managed by Infisical and synced to GCP Secret Manager.
package env
