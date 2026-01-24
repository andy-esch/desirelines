// Package config handles configuration loading for the dispatcher service.
//
// This package loads non-secret configuration from environment variables.
// Secrets (webhook verify token, subscription ID) are handled separately
// by the adapters/env package, which provides caching and hot-reload.
//
// # Basic Usage
//
//	cfg, err := config.LoadConfig()
//	if err != nil {
//	    log.Fatal(err)
//	}
//
//	publisher, _ := pubsub.NewPublisher(ctx, cfg.GCPProjectID, cfg.GCPPubSubTopicID, logger)
//
// # Environment Variables
//
// Required:
//
//	GCP_PROJECT_ID       - Google Cloud project ID
//	GCP_PUBSUB_TOPIC_ID  - Pub/Sub topic for webhook events
//
// Optional (with defaults):
//
//	LOG_LEVEL              - Logging level (default: "INFO")
//	HTTP_READ_TIMEOUT      - Server read timeout (default: 30s)
//	HTTP_WRITE_TIMEOUT     - Server write timeout (default: 30s)
//	HTTP_READ_HEADER_TIMEOUT - Header read timeout (default: 10s)
//	MAX_REQUEST_BODY_SIZE  - Max request body in bytes (default: 1MB)
//
// # Configuration vs Secrets
//
// This package handles non-sensitive configuration only:
//
//	Config (this package)     Secrets (adapters/env)
//	─────────────────────     ─────────────────────
//	GCP_PROJECT_ID            webhook_verify_token
//	GCP_PUBSUB_TOPIC_ID       webhook_subscription_id
//	LOG_LEVEL
//	Timeouts
//
// Secrets are loaded from a mounted file with caching support,
// enabling rotation without service restart.
//
// # Helper Functions
//
// Use [GetEnvOrDefault] for simple environment variable access:
//
//	port := config.GetEnvOrDefault("PORT", "8080")
package config
