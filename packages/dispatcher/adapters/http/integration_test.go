package httpadapter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// NOTE: Basic webhook flow tests are already in handler_test.go.
// These tests focus on concurrency and race conditions.
// Run with: go test -v -race -run TestIntegration ./packages/dispatcher/adapters/http/

// MutableMockSecretProvider allows changing secrets during test execution.
// Used to simulate secret rotation while requests are in flight.
type MutableMockSecretProvider struct {
	mu             sync.RWMutex
	verifyToken    string
	subscriptionID int32
}

func (m *MutableMockSecretProvider) GetSecrets() (string, int32, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.verifyToken, m.subscriptionID, nil
}

func (m *MutableMockSecretProvider) Update(token string, subID int32) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.verifyToken = token
	m.subscriptionID = subID
}

// TestIntegration_ConcurrentRequests tests handling of concurrent webhook requests.
func TestIntegration_ConcurrentRequests(t *testing.T) {
	mockSecrets := &portstest.MockSecretProvider{
		VerifyToken:    "concurrent-token",
		SubscriptionID: 11111,
	}
	mockPub := &portstest.MockPublisher{}
	mockDeauthPub := &portstest.MockPublisher{}
	mockStrava := &portstest.MockStravaClient{
		FetchResult: []byte(`{"id":1,"name":"Run"}`),
	}
	log := gcplog.NewNoOpLogger()

	handler := NewHandler(mockPub, mockDeauthPub, mockSecrets, mockStrava, &portstest.MockTokenStore{}, log, nil)
	router := handler.RegisterRoutes()

	const numRequests = 100
	var wg sync.WaitGroup
	results := make(chan int, numRequests)

	for i := 1; i <= numRequests; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			payload := webhookproto.StravaWebhookJSON{
				AspectType:     "create",
				ObjectType:     "activity",
				ObjectID:       int64(id),
				OwnerID:        456,
				EventTime:      1234567890,
				SubscriptionID: 11111,
			}
			body, err := json.Marshal(payload)
			if err != nil {
				t.Errorf("failed to marshal payload: %v", err)
				return
			}
			req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")

			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)

			results <- rr.Code
		}(i)
	}

	wg.Wait()
	close(results)

	successCount := 0
	statusCounts := make(map[int]int)
	for status := range results {
		statusCounts[status]++
		if status == http.StatusCreated {
			successCount++
		}
	}

	if successCount != numRequests {
		t.Errorf("expected %d successful requests, got %d (status distribution: %v)", numRequests, successCount, statusCounts)
	}

	if mockPub.PublishedCount() != numRequests {
		t.Errorf("expected %d published messages, got %d", numRequests, mockPub.PublishedCount())
	}
}

// TestIntegration_SecretReload tests secret provider behavior change during operation.
func TestIntegration_SecretReload(t *testing.T) {
	mockSecrets := &MutableMockSecretProvider{
		verifyToken:    "initial-token",
		subscriptionID: 22222,
	}
	mockPub := &portstest.MockPublisher{}
	mockStrava := &portstest.MockStravaClient{
		FetchResult: []byte(`{"id":1,"name":"Run"}`),
	}
	log := gcplog.NewNoOpLogger()

	handler := NewHandler(mockPub, &portstest.MockPublisher{}, mockSecrets, mockStrava, &portstest.MockTokenStore{}, log, nil)
	router := handler.RegisterRoutes()

	mustMarshal := func(v any) []byte {
		data, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}
		return data
	}

	// First request with initial subscription ID should succeed
	payload1 := mustMarshal(webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		ObjectType:     "activity",
		ObjectID:       1,
		OwnerID:        456,
		EventTime:      1234567890,
		SubscriptionID: 22222,
	})
	req1 := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload1))
	req1.Header.Set("Content-Type", "application/json")
	rr1 := httptest.NewRecorder()
	router.ServeHTTP(rr1, req1)

	if rr1.Code != http.StatusCreated {
		t.Errorf("first request: expected 201, got %d (body: %s)", rr1.Code, rr1.Body.String())
	}

	// Update secrets (simulating secret rotation)
	mockSecrets.Update("updated-token", 33333)

	// Second request with old subscription ID should fail
	payload2 := mustMarshal(webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		ObjectType:     "activity",
		ObjectID:       2,
		OwnerID:        456,
		EventTime:      1234567890,
		SubscriptionID: 22222,
	})
	req2 := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload2))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	router.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 after secret change, got %d", rr2.Code)
	}

	// Third request with new subscription ID should succeed
	payload3 := mustMarshal(webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		ObjectType:     "activity",
		ObjectID:       3,
		OwnerID:        456,
		EventTime:      1234567890,
		SubscriptionID: 33333,
	})
	req3 := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload3))
	req3.Header.Set("Content-Type", "application/json")
	rr3 := httptest.NewRecorder()
	router.ServeHTTP(rr3, req3)

	if rr3.Code != http.StatusCreated {
		t.Errorf("expected 201 with new secret, got %d (body: %s)", rr3.Code, rr3.Body.String())
	}

	// Verify token rotation works on the verification endpoint too.
	verificationTests := []struct {
		name           string
		token          string
		expectedStatus int
	}{
		{name: "Old token should be rejected", token: "initial-token", expectedStatus: http.StatusUnauthorized},
		{name: "New token should succeed", token: "updated-token", expectedStatus: http.StatusOK},
	}

	for _, tt := range verificationTests {
		t.Run(tt.name, func(t *testing.T) {
			url := fmt.Sprintf("/webhook?hub.mode=subscribe&hub.challenge=test-challenge&hub.verify_token=%s", tt.token)
			req := httptest.NewRequest("GET", url, nil)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)

			if rr.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, rr.Code)
			}
		})
	}
}

// TestIntegration_ConcurrentVerification tests concurrent verification requests.
func TestIntegration_ConcurrentVerification(t *testing.T) {
	mockSecrets := &portstest.MockSecretProvider{
		VerifyToken:    "verify-token",
		SubscriptionID: 12345,
	}
	log := gcplog.NewNoOpLogger()

	handler := NewHandler(&portstest.MockPublisher{}, &portstest.MockPublisher{}, mockSecrets, &portstest.MockStravaClient{}, &portstest.MockTokenStore{}, log, nil)
	router := handler.RegisterRoutes()

	const numRequests = 50
	var wg sync.WaitGroup
	results := make(chan int, numRequests)

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			url := fmt.Sprintf("/webhook?hub.mode=subscribe&hub.challenge=challenge-%d&hub.verify_token=verify-token", id)
			req := httptest.NewRequest("GET", url, nil)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			results <- rr.Code
		}(i)
	}

	wg.Wait()
	close(results)

	successCount := 0
	for status := range results {
		if status == http.StatusOK {
			successCount++
		}
	}

	if successCount != numRequests {
		t.Errorf("expected %d successful verifications, got %d", numRequests, successCount)
	}
}
