package httpadapter

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// setupBenchHandler creates a handler configured for benchmarking.
func setupBenchHandler(b *testing.B) http.Handler {
	b.Helper()

	mockSecrets := &portstest.MockSecretProvider{
		VerifyToken:    "bench-token",
		SubscriptionID: 12345,
	}
	mockPub := &portstest.MockPublisher{}
	mockDeauthPub := &portstest.MockPublisher{}
	mockStrava := &portstest.MockStravaClient{
		FetchResult: []byte(`{"id":12345,"name":"Morning Run"}`),
	}
	log := gcplog.NewNoOpLogger()

	handler := NewHandler(mockPub, mockDeauthPub, mockSecrets, mockStrava, &portstest.MockTokenStore{}, portstest.NewAllowAllMockAllowlist(), log, nil)
	return handler.RegisterRoutes()
}

func BenchmarkHandler_ServeHTTP_ValidWebhook(b *testing.B) {
	router := setupBenchHandler(b)

	payload, err := json.Marshal(webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		ObjectType:     "activity",
		ObjectID:       12345,
		OwnerID:        67890,
		EventTime:      1234567890,
		SubscriptionID: 12345,
	})
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()

		router.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			b.Fatalf("unexpected status: %d", rr.Code)
		}
	}
}

func BenchmarkHandler_ServeHTTP_Verification(b *testing.B) {
	router := setupBenchHandler(b)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("GET", "/webhook?hub.mode=subscribe&hub.challenge=test&hub.verify_token=bench-token", nil)
		rr := httptest.NewRecorder()

		router.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			b.Fatalf("unexpected status: %d", rr.Code)
		}
	}
}

func BenchmarkHandler_ServeHTTP_InvalidWebhook(b *testing.B) {
	router := setupBenchHandler(b)

	body := []byte(`{"invalid": "webhook"}`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()

		router.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadRequest {
			b.Fatalf("unexpected status for invalid webhook: got %d, want %d", rr.Code, http.StatusBadRequest)
		}
	}
}

func BenchmarkHandler_ServeHTTP_Concurrent(b *testing.B) {
	router := setupBenchHandler(b)

	payload, err := json.Marshal(webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		ObjectType:     "activity",
		ObjectID:       12345,
		OwnerID:        67890,
		EventTime:      1234567890,
		SubscriptionID: 12345,
	})
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()

			router.ServeHTTP(rr, req)

			if rr.Code != http.StatusOK {
				b.Errorf("unexpected status in concurrent test: got %d, want %d", rr.Code, http.StatusOK)
			}
		}
	})
}

func BenchmarkWebhook_Validate(b *testing.B) {
	payload := webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		ObjectType:     "activity",
		ObjectID:       12345,
		OwnerID:        67890,
		EventTime:      1234567890,
		SubscriptionID: 12345,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		b.Fatal(err)
	}

	webhook, err := webhookproto.ParseStravaWebhook(data)
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if validateErr := webhookproto.Validate(webhook); validateErr != nil {
			b.Fatal(validateErr)
		}
	}
}

func BenchmarkWebhook_Parse(b *testing.B) {
	data := []byte(`{"aspect_type":"create","object_type":"activity","object_id":12345,"owner_id":67890,"event_time":1234567890,"subscription_id":12345}`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := webhookproto.ParseStravaWebhook(data)
		if err != nil {
			b.Fatal(err)
		}
	}
}
