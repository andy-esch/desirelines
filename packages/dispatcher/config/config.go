// Package config handles configuration loading for the dispatcher service.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
)

const (
	// DefaultSecretsPath is the standard secret volume mount path
	// #nosec G101 - This is a file path, not a credential
	DefaultSecretsPath = "/etc/secrets/strava_auth.json"
)

// Config holds all configuration for the dispatcher.
type Config struct {
	StravaWebhookVerifyToken    string
	GCPProjectID                string
	GCPPubSubTopicID            string
	LogLevel                    string
	StravaWebhookSubscriptionID int
}

// stravaSecrets represents the structure of the mounted secret file.
// Used internally for initial configuration loading.
type stravaSecrets struct {
	WebhookVerifyToken    string `json:"webhook_verify_token"`
	WebhookSubscriptionID int    `json:"webhook_subscription_id"`
}

// LoadConfig loads configuration from environment variables and mounted secrets.
// Secrets from the mounted volume take precedence over environment variables.
func LoadConfig() (*Config, error) {
	// Load webhook secrets from mounted volume if available
	var secrets stravaSecrets
	file, err := os.Open(DefaultSecretsPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("failed to open secrets file: %w", err)
		}
		// File doesn't exist, continue with environment variables
	} else {
		defer file.Close() //nolint:errcheck // Read-only file, close error is non-critical
		if decodeErr := json.NewDecoder(file).Decode(&secrets); decodeErr != nil {
			return nil, fmt.Errorf("failed to decode secrets file: %w", decodeErr)
		}
	}

	// Build config with precedence: secrets file > env vars > defaults
	verifyToken := secrets.WebhookVerifyToken
	if verifyToken == "" {
		verifyToken = GetEnvOrDefault("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
	}

	subscriptionID := secrets.WebhookSubscriptionID
	if subscriptionID == 0 {
		subIDStr := GetEnvOrDefault("STRAVA_WEBHOOK_SUBSCRIPTION_ID", "0")
		parsed, parseErr := strconv.Atoi(subIDStr)
		if parseErr != nil {
			return nil, fmt.Errorf("invalid STRAVA_WEBHOOK_SUBSCRIPTION_ID: %w", parseErr)
		}
		subscriptionID = parsed
	}

	return &Config{
		StravaWebhookVerifyToken:    verifyToken,
		StravaWebhookSubscriptionID: subscriptionID,
		GCPProjectID:                GetEnvOrDefault("GCP_PROJECT_ID", ""),
		GCPPubSubTopicID:            GetEnvOrDefault("GCP_PUBSUB_TOPIC", ""),
		LogLevel:                    GetEnvOrDefault("LOG_LEVEL", "INFO"),
	}, nil
}

// GetEnvOrDefault returns the value of an environment variable or a default value.
// This is exported for use in cmd/local and other entry points.
func GetEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
