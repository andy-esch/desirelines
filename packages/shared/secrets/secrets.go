// Package secrets provides helpers for loading secrets from Infisical file mounts
// with environment variable fallback for local development.
package secrets

import (
	"fmt"
	"os"
	"strings"
)

// LoadFromMount reads a secret from a file path (Infisical mount), falling back
// to an environment variable. Returns an error if both sources are unavailable,
// wrapping the original file-read error for debuggability.
func LoadFromMount(filePath, envFallback string) (string, error) {
	data, err := os.ReadFile(filePath) //nolint:gosec // Paths come from trusted config constants
	if err == nil {
		return strings.TrimSpace(string(data)), nil
	}

	if envFallback != "" {
		if val := os.Getenv(envFallback); val != "" {
			return val, nil
		}
	}

	return "", fmt.Errorf("secret unavailable: failed to read %s: %w", filePath, err)
}
