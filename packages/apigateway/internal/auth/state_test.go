package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestStateRoundTrip(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")

	state, err := generateState(secret)
	if err != nil {
		t.Fatalf("generateState() error = %v", err)
	}

	if validateErr := validateState(state, secret); validateErr != nil {
		t.Errorf("validateState() error = %v", validateErr)
	}
}

func TestStateExpired(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")

	// Create a token that expired 1 minute ago
	claims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Minute)),
		IssuedAt:  jwt.NewNumericDate(time.Now().Add(-6 * time.Minute)),
		ID:        "expired-nonce",
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		t.Fatalf("failed to create expired token: %v", err)
	}

	if validateErr := validateState(signed, secret); validateErr == nil {
		t.Error("validateState() expected error for expired token, got nil")
	}
}

func TestStateWrongSecret(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	wrongSecret := []byte("wrong-secret-key-32-bytes-long!!")

	state, err := generateState(secret)
	if err != nil {
		t.Fatalf("generateState() error = %v", err)
	}

	if validateErr := validateState(state, wrongSecret); validateErr == nil {
		t.Error("validateState() expected error for wrong secret, got nil")
	}
}

func TestStateTampered(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")

	state, err := generateState(secret)
	if err != nil {
		t.Fatalf("generateState() error = %v", err)
	}

	// Flip a character in the middle of the token
	tampered := []byte(state)
	tampered[len(tampered)/2] ^= 0xFF
	if validateErr := validateState(string(tampered), secret); validateErr == nil {
		t.Error("validateState() expected error for tampered token, got nil")
	}
}

func TestStateEmpty(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")

	if err := validateState("", secret); err == nil {
		t.Error("validateState() expected error for empty string, got nil")
	}
}

func TestStateMalformed(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")

	if err := validateState("not-a-jwt", secret); err == nil {
		t.Error("validateState() expected error for malformed string, got nil")
	}
}

func TestStateRejectsUnexpectedHMACAlgorithm(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	claims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ID:        "nonce",
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS512, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		t.Fatalf("failed to sign HS512 state: %v", err)
	}

	if validateErr := validateState(signed, secret); validateErr == nil {
		t.Error("validateState() accepted HS512 even though the service only signs HS256")
	}
}

func TestStateRequiresExpiryAndNonce(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	claims := jwt.RegisteredClaims{IssuedAt: jwt.NewNumericDate(time.Now())}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		t.Fatalf("failed to sign incomplete state: %v", err)
	}

	if validateErr := validateState(signed, secret); validateErr == nil {
		t.Error("validateState() accepted state without expiry and nonce")
	}
}

func TestStateUniqueNonces(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")

	state1, err := generateState(secret)
	if err != nil {
		t.Fatalf("generateState() error = %v", err)
	}
	state2, err := generateState(secret)
	if err != nil {
		t.Fatalf("generateState() error = %v", err)
	}

	if state1 == state2 {
		t.Error("expected unique state tokens, got identical values")
	}
}
