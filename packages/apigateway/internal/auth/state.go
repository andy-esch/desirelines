package auth

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const stateExpiry = 5 * time.Minute

// generateState creates a signed JWT state token with a 5-minute expiry and random nonce.
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
	_, err := jwt.ParseWithClaims(tokenString, &jwt.RegisteredClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return secret, nil
	})
	if err != nil {
		return fmt.Errorf("invalid state token: %w", err)
	}
	return nil
}
