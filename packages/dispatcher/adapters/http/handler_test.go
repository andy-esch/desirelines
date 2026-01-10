package httpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/pkg/logger"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
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

			req := httptest.NewRequest(tt.method, "/webhook", nil)
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
	// Use StravaWebhookJSON to simulate incoming JSON payload from Strava (string enums)
	validPayload := webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		EventTime:      1234567890,
		ObjectID:       12345,
		ObjectType:     "activity",
		OwnerID:        67890,
		SubscriptionID: 123,
		Updates:        map[string]string{},
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
			expectedBody:   "", // chi default 405 body
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
			name:           "Parse error (missing object_type)",
			method:         "POST",
			contentType:    "application/json",
			payload:        webhookproto.StravaWebhookJSON{AspectType: "create"}, // Missing object_type fails at parse
			expectedStatus: http.StatusBadRequest,
			expectedBody:   "Invalid JSON payload",
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
			payload: webhookproto.StravaWebhookJSON{
				AspectType:     "create",
				EventTime:      1234567890,
				ObjectID:       12345,
				ObjectType:     "athlete", // Not activity
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

			req := httptest.NewRequest(tt.method, "/webhook", strings.NewReader(string(body)))
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
				} else {
					// Verify the published event content
					event := mockPublisher.Published[0]
					if event.ObjectId != 12345 {
						t.Errorf("expected object_id 12345, got %d", event.ObjectId)
					}
					if event.ObjectType != generated.ObjectType_OBJECT_TYPE_ACTIVITY {
						t.Errorf("expected object_type ACTIVITY, got %v", event.ObjectType)
					}
				}
			}
		})
	}
}

// Test health endpoints
func TestHandler_Health(t *testing.T) {
	log := logger.NewNoOpLogger()
	handler := NewHandler(&portstest.MockPublisher{}, &portstest.MockSecretProvider{}, log)
	router := handler.RegisterRoutes()

	tests := []struct {
		name           string
		method         string
		path           string
		expectedStatus int
	}{
		{
			name:           "HEAD / returns 200",
			method:         "HEAD",
			path:           "/",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "GET /health returns 200",
			method:         "GET",
			path:           "/health",
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
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
