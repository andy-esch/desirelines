package httpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/andy-esch/desirelines/packages/dispatcher/domain"
	"github.com/andy-esch/desirelines/packages/dispatcher/pkg/logger"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
)

func TestHandler_HandleVerification(t *testing.T) {
	tests := []struct {
		name           string
		method         string
		queryParams    map[string]string
		mockVerify     string
		mockVerifyErr  error
		expectedStatus int
		expectedBody   string
	}{
		{
			name:   "Valid subscription request",
			method: "GET",
			queryParams: map[string]string{
				"hub.mode":         "subscribe",
				"hub.challenge":    "challenge-token",
				"hub.verify_token": "valid-token",
			},
			mockVerify:     "valid-token",
			expectedStatus: http.StatusOK,
			expectedBody:   `{"hub.challenge":"challenge-token"}`,
		},
		{
			name:   "Invalid verify token",
			method: "GET",
			queryParams: map[string]string{
				"hub.mode":         "subscribe",
				"hub.challenge":    "challenge-token",
				"hub.verify_token": "invalid-token",
			},
			mockVerify:     "valid-token",
			expectedStatus: http.StatusUnauthorized,
			expectedBody:   "Invalid verify token",
		},
		{
			name:   "Invalid hub mode",
			method: "GET",
			queryParams: map[string]string{
				"hub.mode":         "invalid",
				"hub.challenge":    "challenge-token",
				"hub.verify_token": "valid-token",
			},
			mockVerify:     "valid-token",
			expectedStatus: http.StatusBadRequest,
			expectedBody:   "invalid hub.mode: invalid",
		},
		{
			name:   "Configuration error",
			method: "GET",
			queryParams: map[string]string{
				"hub.mode":         "subscribe",
				"hub.challenge":    "challenge-token",
				"hub.verify_token": "valid-token",
			},
			mockVerifyErr:  errors.New("config error"),
			expectedStatus: http.StatusInternalServerError,
			expectedBody:   "Configuration error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			log := logger.NewNoOpLogger()
			mockSecrets := &portstest.MockSecretProvider{
				VerifyToken: tt.mockVerify,
				Err:         tt.mockVerifyErr,
			}
			mockPublisher := &portstest.MockPublisher{}

			handler := NewHandler(mockPublisher, mockSecrets, log)
			router := handler.RegisterRoutes()

			req := httptest.NewRequest(tt.method, "/", nil)
			q := req.URL.Query()
			for k, v := range tt.queryParams {
				q.Add(k, v)
			}
			req.URL.RawQuery = q.Encode()

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			if !strings.Contains(w.Body.String(), tt.expectedBody) {
				t.Errorf("expected body to contain %q, got %q", tt.expectedBody, w.Body.String())
			}
		})
	}
}

func TestHandler_HandleEvent(t *testing.T) {
	validPayload := domain.WebhookRequest{
		AspectType:     domain.AspectCreate,
		EventTime:      1234567890,
		ObjectID:       12345,
		ObjectType:     domain.ObjectActivity,
		OwnerID:        67890,
		SubscriptionID: 123,
		Updates:        map[string]any{},
	}

	tests := []struct {
		name           string
		method         string
		contentType    string
		payload        any
		mockSubID      int
		mockSubErr     error
		publishErr     error
		expectedStatus int
		expectedBody   string
	}{
		{
			name:           "Valid event",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      123,
			expectedStatus: http.StatusCreated,
			expectedBody:   "success",
		},
		{
			name:           "Invalid method",
			method:         "PUT",
			contentType:    "application/json",
			payload:        validPayload,
			expectedStatus: http.StatusMethodNotAllowed,
			expectedBody:   "", // chi default 405 body is empty
		},
		{
			name:           "Invalid content type",
			method:         "POST",
			contentType:    "text/plain",
			payload:        validPayload,
			expectedStatus: http.StatusUnsupportedMediaType,
			expectedBody:   "Content-Type must be application/json",
		},
		{
			name:           "Invalid JSON",
			method:         "POST",
			contentType:    "application/json",
			payload:        "invalid-json",
			expectedStatus: http.StatusBadRequest,
			expectedBody:   "Invalid JSON payload",
		},
		{
			name:           "Validation error (missing field)",
			method:         "POST",
			contentType:    "application/json",
			payload:        domain.WebhookRequest{AspectType: domain.AspectCreate}, // Missing required fields
			expectedStatus: http.StatusBadRequest,
			expectedBody:   "Webhook validation failed",
		},
		{
			name:           "Configuration error",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubErr:     errors.New("config error"),
			expectedStatus: http.StatusInternalServerError,
			expectedBody:   "Configuration error",
		},
		{
			name:           "Invalid subscription ID",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      999, // Mismatch
			expectedStatus: http.StatusUnauthorized,
			expectedBody:   "Invalid subscription_id",
		},
		{
			name:        "Non-activity event (ignored)",
			method:      "POST",
			contentType: "application/json",
			payload: domain.WebhookRequest{
				AspectType:     domain.AspectCreate,
				EventTime:      1234567890,
				ObjectID:       12345,
				ObjectType:     domain.ObjectAthlete, // Not activity
				OwnerID:        67890,
				SubscriptionID: 123,
			},
			mockSubID:      123,
			expectedStatus: http.StatusCreated,
			expectedBody:   "success",
		},
		{
			name:           "Publish error",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      123,
			publishErr:     errors.New("publish failed"),
			expectedStatus: http.StatusInternalServerError,
			expectedBody:   "Failed to publish event",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			log := logger.NewNoOpLogger()
			mockSecrets := &portstest.MockSecretProvider{
				SubscriptionID: tt.mockSubID,
				Err:            tt.mockSubErr,
			}
			mockPublisher := &portstest.MockPublisher{
				PublishErr: tt.publishErr,
			}

			handler := NewHandler(mockPublisher, mockSecrets, log)
			router := handler.RegisterRoutes()

			var body []byte
			if s, ok := tt.payload.(string); ok {
				body = []byte(s)
			} else {
				var marshalErr error
				body, marshalErr = json.Marshal(tt.payload)
				if marshalErr != nil {
					t.Fatalf("Failed to marshal payload: %v", marshalErr)
				}
			}

			req := httptest.NewRequest(tt.method, "/", strings.NewReader(string(body)))
			if tt.contentType != "" {
				req.Header.Set("Content-Type", tt.contentType)
			}

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			if !strings.Contains(w.Body.String(), tt.expectedBody) {
				t.Errorf("expected body to contain %q, got %q", tt.expectedBody, w.Body.String())
			}

			// Verify publisher was called for valid activity events
			if tt.expectedStatus == http.StatusCreated && tt.name == "Valid event" {
				if len(mockPublisher.Published) != 1 {
					t.Error("expected 1 published event")
				}
			}
		})
	}
}

// Test Close
func TestHandler_Close(t *testing.T) {
	mockPublisher := &portstest.MockPublisher{}
	handler := NewHandler(mockPublisher, &portstest.MockSecretProvider{}, logger.NewNoOpLogger())

	err := handler.Close(context.Background())
	if err != nil {
		t.Errorf("Close returned error: %v", err)
	}
}
