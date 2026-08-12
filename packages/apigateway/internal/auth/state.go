package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// stateExpiry is the lifetime of the OAuth state token. 10 minutes is generous enough
// for slow networks + a distracted user reading Strava's scope grant page, while still
// keeping the replay window modest. Token is signed; not stored single-use, so the
// window matters.
const stateExpiry = 10 * time.Minute

// generateState creates a signed JWT state token with a 10-minute expiry and random nonce.
// Used to prevent CSRF during the Strava OAuth redirect flow.
func generateState(secret []byte) (string, error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	now := time.Now()
	claims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(now.Add(stateExpiry)),
		IssuedAt:  jwt.NewNumericDate(now),
		ID:        hex.EncodeToString(nonce),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		return "", fmt.Errorf("sign state token: %w", err)
	}

	return signed, nil
}

// validateState verifies the signature and expiry of a state JWT token.
func validateState(tokenString string, secret []byte) error {
	claims := &jwt.RegisteredClaims{}
	_, err := jwt.ParseWithClaims(tokenString, claims, func(_ *jwt.Token) (interface{}, error) {
		return secret, nil
	},
		// Pin the one algorithm generateState uses. Accepting the whole HMAC
		// family makes the verifier's contract broader than the signer and can
		// hide an algorithm-confusion regression during future JWT changes.
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
	)
	if err != nil {
		return fmt.Errorf("invalid state token: %w", err)
	}
	if claims.ID == "" {
		return fmt.Errorf("invalid state token: missing nonce")
	}
	return nil
}
