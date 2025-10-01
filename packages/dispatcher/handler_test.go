package dispatcher

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHandler_ServeHTTP_Verification(t *testing.T) {
	// Create temporary secrets file
	tempDir, err := os.MkdirTemp("", "handler_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	secretsPath := filepath.Join(tempDir, "strava_auth.json")
	secrets := map[string]interface{}{
		"webhook_verify_token":    "test-token",
		"webhook_subscription_id": 12345,
	}
	writeTestSecretsFile(t, secretsPath, secrets)

	cfg := &Config{}
	mockPub := &MockPublisher{}
	handler := NewHandlerWithPublisher(cfg, mockPub)

	// Override the secret cache path for testing
	handler.secretCache = NewSecretCache(secretsPath, time.Minute)

	// Valid request
	req := httptest.NewRequest("GET", "/?hub.mode=subscribe&hub.challenge=test-challenge&hub.verify_token=test-token", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v", status, http.StatusOK)
	}
	if !strings.Contains(rr.Body.String(), "test-challenge") {
		t.Errorf("handler returned unexpected body: got %v", rr.Body.String())
	}

	// Invalid token
	req = httptest.NewRequest("GET", "/?hub.mode=subscribe&hub.challenge=test-challenge&hub.verify_token=wrong-token", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusUnauthorized {
		t.Errorf("handler returned wrong status code for bad token: got %v want %v", status, http.StatusUnauthorized)
	}
}

func TestHandler_ServeHTTP_Event(t *testing.T) {
	// Create temporary secrets file
	tempDir, err := os.MkdirTemp("", "handler_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	secretsPath := filepath.Join(tempDir, "strava_auth.json")
	secrets := map[string]interface{}{
		"webhook_verify_token":    "test-token",
		"webhook_subscription_id": 12345,
	}
	writeTestSecretsFile(t, secretsPath, secrets)

	cfg := &Config{}
	mockPub := &MockPublisher{}
	handler := NewHandlerWithPublisher(cfg, mockPub)

	// Override the secret cache path for testing
	handler.secretCache = NewSecretCache(secretsPath, time.Minute)

	// Valid event
	body := `{"aspect_type":"create","object_type":"activity","object_id":1,"owner_id":1,"event_time":1,"subscription_id":12345}`
	req := httptest.NewRequest("POST", "/", strings.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusCreated {
		t.Errorf("handler returned wrong status code: got %v want %v", status, http.StatusCreated)
	}
	if len(mockPub.Published) != 1 {
		t.Errorf("expected 1 message to be published, got %d", len(mockPub.Published))
	}
	if mockPub.Published[0].ObjectID != 1 {
		t.Errorf("published message has wrong ObjectID: got %d want %d", mockPub.Published[0].ObjectID, 1)
	}

	// Invalid subscription ID
	mockPub.Published = nil // Reset mock
	body = `{"aspect_type":"create","object_type":"activity","object_id":1,"owner_id":1,"event_time":1,"subscription_id":99999}`
	req = httptest.NewRequest("POST", "/", strings.NewReader(body))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusUnauthorized {
		t.Errorf("handler returned wrong status code for bad sub id: got %v want %v", status, http.StatusUnauthorized)
	}
	if len(mockPub.Published) != 0 {
		t.Errorf("expected 0 messages to be published for bad sub id, got %d", len(mockPub.Published))
	}

	// Non-activity event (should be ignored)
	mockPub.Published = nil // Reset mock
	body = `{"aspect_type":"update","object_type":"athlete","object_id":1,"owner_id":1,"event_time":1,"subscription_id":12345}`
	req = httptest.NewRequest("POST", "/", strings.NewReader(body))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusCreated {
		t.Errorf("handler returned wrong status code for ignored event: got %v want %v", status, http.StatusCreated)
	}
	if len(mockPub.Published) != 0 {
		t.Errorf("expected 0 messages to be published for ignored event, got %d", len(mockPub.Published))
	}
}

// Helper function to write test secrets file
func writeTestSecretsFile(t *testing.T, path string, secrets map[string]interface{}) {
	data, err := json.Marshal(secrets)
	if err != nil {
		t.Fatalf("Failed to marshal secrets: %v", err)
	}

	err = os.WriteFile(path, data, 0644)
	if err != nil {
		t.Fatalf("Failed to write secrets file: %v", err)
	}
}
