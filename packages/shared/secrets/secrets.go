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
//
// A present-but-empty (or whitespace-only) mount file is treated as an absent
// secret, not a successful load of "". Returning ("", nil) meant a caller could
// not distinguish "the secret is empty" from "the secret loaded fine", and it
// shadowed the documented env fallback: an empty mount would win over a
// perfectly good environment variable. It also let the process start having
// signed things with an empty key. This restores the symmetry the env path
// already had, where a set-but-empty variable is likewise rejected.
func LoadFromMount(filePath, envFallback string) (string, error) {
	var cause error

	data, err := os.ReadFile(filePath) //nolint:gosec // Paths come from trusted config constants
	if err != nil {
		cause = fmt.Errorf("failed to read %s: %w", filePath, err)
	} else if secret := strings.TrimSpace(string(data)); secret != "" {
		return secret, nil
	} else {
		cause = fmt.Errorf("%s is present but empty", filePath)
	}

	if envFallback != "" {
		if val := os.Getenv(envFallback); val != "" {
			return val, nil
		}
	}

	return "", fmt.Errorf("secret unavailable: %w", cause)
}
