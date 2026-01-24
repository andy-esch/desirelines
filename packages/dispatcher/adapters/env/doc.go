// Package env provides adapters for loading configuration and secrets from the environment and filesystem.
//
// This adapter implements [ports.SecretProvider] to retrieve Strava webhook
// verification secrets from a mounted secrets file (typical in Cloud Run/Kubernetes).
//
// # Basic Usage
//
//	secretProvider := env.NewDefaultSecretCache(logger)
//	verifyToken, subscriptionID, err := secretProvider.GetSecrets()
//
// # Secret File Format
//
// The secrets file must be JSON with this structure:
//
//	{
//	    "webhook_verify_token": "your-strava-verify-token",
//	    "webhook_subscription_id": 12345
//	}
//
// Default path: /etc/secrets/strava/secrets.json (configurable via constructor)
//
// # Security
//
// The adapter enforces secure file permissions:
//   - Maximum allowed mode is 0600 (owner read/write only)
//   - Files with more permissive modes are rejected
//
// # Caching
//
// [SecretCache] provides TTL-based caching with content-hash validation:
//   - Secrets are cached for 5 minutes by default
//   - On cache expiry, file is re-read only if content hash changed
//   - Enables secret rotation without service restart
//
// Example with custom TTL:
//
//	cache := env.NewSecretCache("/path/to/secrets.json", 1*time.Minute, logger)
//
// # Thread Safety
//
// [SecretCache] is safe for concurrent use. Multiple goroutines may call
// GetSecrets simultaneously.
//
// # Cloud Run Integration
//
// In Cloud Run, mount secrets from Secret Manager:
//
//	gcloud run services update dispatcher \
//	    --update-secrets=/etc/secrets/strava/secrets.json=strava-webhook-secrets:latest
package env
