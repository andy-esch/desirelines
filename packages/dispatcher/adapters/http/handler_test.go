package httpadapter

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// Test constants for webhook event data.
// Using descriptive names makes test intent clearer.
const (
	testEventTime      = 1234567890 // Unix timestamp for test events
	testObjectID       = 12345      // Strava activity ID
	testOwnerID        = 67890      // Strava athlete ID
	testSubscriptionID = 123        // Webhook subscription ID
)

// parseErrorResponse parses a JSON error response body.
// Returns nil if parsing fails (e.g., for non-JSON responses).
func parseErrorResponse(body string) *gcplog.ErrorResponse {
	var resp gcplog.ErrorResponse
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		return nil
	}
	return &resp
}

func TestHandler_HandleVerification(t *testing.T) {
	tests := []struct {
		name           string
		method         string
		queryParams    map[string]string
		mockVerify     string
		mockVerifyErr  error
		expectedStatus int
		expectedCode   string // Machine-readable error code (use instead of message matching)
		expectedBody   string // For success responses only
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
			expectedCode:   "INVALID_VERIFY_TOKEN",
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
			expectedCode:   "INVALID_HUB_MODE",
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
			expectedCode:   "CONFIG_ERROR",
		},
		{
			name:   "Empty challenge",
			method: "GET",
			queryParams: map[string]string{
				"hub.mode":         "subscribe",
				"hub.challenge":    "",
				"hub.verify_token": "valid-token",
			},
			mockVerify:     "valid-token",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "INVALID_CHALLENGE",
		},
		{
			name:   "Oversized challenge",
			method: "GET",
			queryParams: map[string]string{
				"hub.mode":         "subscribe",
				"hub.challenge":    strings.Repeat("x", 257),
				"hub.verify_token": "valid-token",
			},
			mockVerify:     "valid-token",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "INVALID_CHALLENGE",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			log := gcplog.NewNoOpLogger()
			mockSecrets := &portstest.MockSecretProvider{
				VerifyToken: tt.mockVerify,
				Err:         tt.mockVerifyErr,
			}
			mockPublisher := &portstest.MockPublisher{}
			mockStrava := &portstest.MockStravaClient{}

			handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, mockSecrets, mockStrava, &portstest.MockTokenStore{}, log, nil)
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

			// Check error code for error responses (more robust than message matching)
			if tt.expectedCode != "" {
				errResp := parseErrorResponse(w.Body.String())
				if errResp == nil {
					t.Errorf("expected JSON error response with code %q, got non-JSON: %q", tt.expectedCode, w.Body.String())
				} else if errResp.Code != tt.expectedCode {
					t.Errorf("expected error code %q, got %q", tt.expectedCode, errResp.Code)
				}
			} else if tt.expectedBody != "" {
				// For success responses, check body contains expected content
				if !strings.Contains(w.Body.String(), tt.expectedBody) {
					t.Errorf("expected body to contain %q, got %q", tt.expectedBody, w.Body.String())
				}
			}
		})
	}
}

func TestHandler_HandleEvent(t *testing.T) {
	// Use StravaWebhookJSON to simulate incoming JSON payload from Strava (string enums)
	validPayload := webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		EventTime:      testEventTime,
		ObjectID:       testObjectID,
		ObjectType:     "activity",
		OwnerID:        testOwnerID,
		SubscriptionID: testSubscriptionID,
		Updates:        map[string]string{},
	}

	tests := []handleEventTestCase{
		{
			name:           "Valid create event with enrichment",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      testSubscriptionID,
			stravaResult:   []byte(`{"id":12345,"name":"Morning Run"}`),
			expectedStatus: http.StatusCreated,
			expectedBody:   "published",
		},
		{
			name:        "Valid update event (no Strava fetch)",
			method:      "POST",
			contentType: "application/json",
			payload: webhookproto.StravaWebhookJSON{
				AspectType:     "update",
				EventTime:      testEventTime,
				ObjectID:       testObjectID,
				ObjectType:     "activity",
				OwnerID:        testOwnerID,
				SubscriptionID: testSubscriptionID,
				Updates:        map[string]string{"title": "Evening Run"},
			},
			mockSubID:      testSubscriptionID,
			expectedStatus: http.StatusCreated,
			expectedBody:   "published",
		},
		{
			name:        "Valid delete event (no Strava fetch)",
			method:      "POST",
			contentType: "application/json",
			payload: webhookproto.StravaWebhookJSON{
				AspectType:     "delete",
				EventTime:      testEventTime,
				ObjectID:       testObjectID,
				ObjectType:     "activity",
				OwnerID:        testOwnerID,
				SubscriptionID: testSubscriptionID,
			},
			mockSubID:      testSubscriptionID,
			expectedStatus: http.StatusCreated,
			expectedBody:   "published",
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
			expectedCode:   "INVALID_CONTENT_TYPE",
		},
		{
			name:           "Invalid JSON",
			method:         "POST",
			contentType:    "application/json",
			payload:        "invalid-json",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "INVALID_JSON",
		},
		{
			name:           "Parse error (missing object_type)",
			method:         "POST",
			contentType:    "application/json",
			payload:        webhookproto.StravaWebhookJSON{AspectType: "create"}, // Missing object_type fails at parse
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "INVALID_JSON",
		},
		{
			name:           "Configuration error",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubErr:     errors.New("config error"),
			expectedStatus: http.StatusInternalServerError,
			expectedCode:   "CONFIG_ERROR",
		},
		{
			name:           "Invalid subscription ID",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      999, // Mismatch
			expectedStatus: http.StatusUnauthorized,
			expectedCode:   "INVALID_SUBSCRIPTION_ID",
		},
		{
			name:        "Non-deauth athlete create event acknowledged",
			method:      "POST",
			contentType: "application/json",
			payload: webhookproto.StravaWebhookJSON{
				AspectType:     "create",
				EventTime:      testEventTime,
				ObjectID:       testObjectID,
				ObjectType:     "athlete",
				OwnerID:        testOwnerID,
				SubscriptionID: testSubscriptionID,
			},
			mockSubID:      testSubscriptionID,
			expectedStatus: http.StatusOK,
			expectedBody:   "acknowledged",
		},
		{
			name:           "Publish error",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      testSubscriptionID,
			stravaResult:   []byte(`{"id":12345}`),
			publishErr:     errors.New("publish failed"),
			expectedStatus: http.StatusInternalServerError,
			expectedCode:   "PUBLISH_FAILED",
		},
		{
			name:           "Strava fetch failure returns 500",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      testSubscriptionID,
			stravaErr:      errors.New("strava API error"),
			expectedStatus: http.StatusInternalServerError,
			expectedCode:   "STRAVA_FETCH_FAILED",
		},
		{
			name:           "Oversized request body",
			method:         "POST",
			contentType:    "application/json",
			payload:        strings.Repeat("x", 1<<20+1), // Exceeds DefaultMaxRequestBodySize (1MB)
			mockSubID:      testSubscriptionID,
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "READ_FAILED",
		},
		{
			name:        "Validation failure (event_time=0)",
			method:      "POST",
			contentType: "application/json",
			payload: webhookproto.StravaWebhookJSON{
				AspectType:     "create",
				EventTime:      0, // Passes parse but fails Validate
				ObjectID:       testObjectID,
				ObjectType:     "activity",
				OwnerID:        testOwnerID,
				SubscriptionID: testSubscriptionID,
			},
			mockSubID:      testSubscriptionID,
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "VALIDATION_FAILED",
		},
		{
			name:           "Strava 404 publishes without activity data",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      testSubscriptionID,
			stravaErr:      ports.ErrActivityNotFound,
			expectedStatus: http.StatusCreated,
			expectedBody:   "published",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runHandleEventTest(t, &tt)
		})
	}
}

type handleEventTestCase struct {
	name                string
	method              string
	contentType         string
	payload             any
	mockSubID           int32
	mockSubErr          error
	publishErr          error
	deauthPublishErr    error
	stravaResult        []byte
	stravaErr           error
	mockTokenStore      *portstest.MockTokenStore
	mockDeauthPublisher *portstest.MockPublisher
	expectedStatus      int
	expectedCode        string
	expectedBody        string
}

func mockTokenStoreOrDefault(ts *portstest.MockTokenStore) *portstest.MockTokenStore {
	if ts != nil {
		return ts
	}
	return &portstest.MockTokenStore{}
}

func mockDeauthPublisherOrDefault(pub *portstest.MockPublisher, publishErr error) *portstest.MockPublisher {
	if pub != nil {
		return pub
	}
	return &portstest.MockPublisher{PublishErr: publishErr}
}

func runHandleEventTest(t *testing.T, tt *handleEventTestCase) {
	log := gcplog.NewNoOpLogger()
	mockSecrets := &portstest.MockSecretProvider{
		SubscriptionID: tt.mockSubID,
		Err:            tt.mockSubErr,
	}
	mockPublisher := &portstest.MockPublisher{
		PublishErr: tt.publishErr,
	}
	mockDeauthPublisher := mockDeauthPublisherOrDefault(tt.mockDeauthPublisher, tt.deauthPublishErr)
	mockStrava := &portstest.MockStravaClient{
		FetchResult: tt.stravaResult,
		FetchErr:    tt.stravaErr,
	}

	handler := NewHandler(mockPublisher, mockDeauthPublisher, mockSecrets, mockStrava, mockTokenStoreOrDefault(tt.mockTokenStore), log, nil)
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

	req := httptest.NewRequest(tt.method, "/webhook", bytes.NewReader(body))
	if tt.contentType != "" {
		req.Header.Set("Content-Type", tt.contentType)
	}

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != tt.expectedStatus {
		t.Errorf("expected status %d, got %d (body: %s)", tt.expectedStatus, w.Code, w.Body.String())
	}

	// Check error code for error responses (more robust than message matching)
	if tt.expectedCode != "" {
		errResp := parseErrorResponse(w.Body.String())
		if errResp == nil {
			t.Errorf("expected JSON error response with code %q, got non-JSON: %q", tt.expectedCode, w.Body.String())
		} else if errResp.Code != tt.expectedCode {
			t.Errorf("expected error code %q, got %q", tt.expectedCode, errResp.Code)
		}
	} else if tt.expectedBody != "" {
		// For success responses, check body contains expected content
		if !strings.Contains(w.Body.String(), tt.expectedBody) {
			t.Errorf("expected body to contain %q, got %q", tt.expectedBody, w.Body.String())
		}
	}

	// Verify published enriched events for successful publishes
	if tt.expectedStatus == http.StatusCreated && len(mockPublisher.Published) > 0 {
		enriched := mockPublisher.Published[0]
		if enriched.Event == nil {
			t.Fatal("published enriched event has nil Event")
		}
		event := enriched.Event
		if event.ObjectId != testObjectID {
			t.Errorf("expected object_id %d, got %d", testObjectID, event.ObjectId)
		}
		if event.ObjectType != generated.ObjectType_OBJECT_TYPE_ACTIVITY {
			t.Errorf("expected object_type ACTIVITY, got %v", event.ObjectType)
		}
	}
}

func TestHandler_AthleteDeauth(t *testing.T) {
	deauthDeletePayload := webhookproto.StravaWebhookJSON{
		AspectType:     "delete",
		EventTime:      testEventTime,
		ObjectID:       testOwnerID,
		ObjectType:     "athlete",
		OwnerID:        testOwnerID,
		SubscriptionID: testSubscriptionID,
	}

	t.Run("Deauth delete deletes tokens and publishes to deauth topic", func(t *testing.T) {
		mockTokens := &portstest.MockTokenStore{}
		mockDeauth := &portstest.MockPublisher{}
		tt := handleEventTestCase{
			method:              "POST",
			contentType:         "application/json",
			payload:             deauthDeletePayload,
			mockSubID:           testSubscriptionID,
			mockTokenStore:      mockTokens,
			mockDeauthPublisher: mockDeauth,
			expectedStatus:      http.StatusOK,
			expectedBody:        "acknowledged",
		}
		runHandleEventTest(t, &tt)

		if len(mockTokens.DeletedAthleteIDs) != 1 || mockTokens.DeletedAthleteIDs[0] != testOwnerID {
			t.Errorf("expected DeleteTokens called with athlete %d, got %v", testOwnerID, mockTokens.DeletedAthleteIDs)
		}
		// Verify deauth event was published to deauth publisher, not activity publisher
		if len(mockDeauth.Published) != 1 {
			t.Errorf("expected 1 event published to deauth topic, got %d", len(mockDeauth.Published))
		}
	})

	t.Run("Deauth update with authorized false deletes tokens and publishes", func(t *testing.T) {
		mockTokens := &portstest.MockTokenStore{}
		tt := handleEventTestCase{
			method:      "POST",
			contentType: "application/json",
			payload: webhookproto.StravaWebhookJSON{
				AspectType:     "update",
				EventTime:      testEventTime,
				ObjectID:       testOwnerID,
				ObjectType:     "athlete",
				OwnerID:        testOwnerID,
				SubscriptionID: testSubscriptionID,
				Updates:        map[string]string{"authorized": "false"},
			},
			mockSubID:      testSubscriptionID,
			mockTokenStore: mockTokens,
			expectedStatus: http.StatusOK,
			expectedBody:   "acknowledged",
		}
		runHandleEventTest(t, &tt)

		if len(mockTokens.DeletedAthleteIDs) != 1 || mockTokens.DeletedAthleteIDs[0] != testOwnerID {
			t.Errorf("expected DeleteTokens called with athlete %d, got %v", testOwnerID, mockTokens.DeletedAthleteIDs)
		}
	})

	t.Run("Deauth with token deletion failure still publishes and returns 200", func(t *testing.T) {
		mockTokens := &portstest.MockTokenStore{
			DeleteErr: errors.New("firestore unavailable"),
		}
		tt := handleEventTestCase{
			method:         "POST",
			contentType:    "application/json",
			payload:        deauthDeletePayload,
			mockSubID:      testSubscriptionID,
			mockTokenStore: mockTokens,
			expectedStatus: http.StatusOK,
			expectedBody:   "acknowledged",
		}
		runHandleEventTest(t, &tt)

		if len(mockTokens.DeletedAthleteIDs) != 1 {
			t.Errorf("expected DeleteTokens to be called, got %v", mockTokens.DeletedAthleteIDs)
		}
	})

	t.Run("Deauth with publish failure returns 500", func(t *testing.T) {
		mockTokens := &portstest.MockTokenStore{}
		tt := handleEventTestCase{
			method:           "POST",
			contentType:      "application/json",
			payload:          deauthDeletePayload,
			mockSubID:        testSubscriptionID,
			mockTokenStore:   mockTokens,
			deauthPublishErr: errors.New("pubsub unavailable"),
			expectedStatus:   http.StatusInternalServerError,
			expectedCode:     "DEAUTH_FAILED",
		}
		runHandleEventTest(t, &tt)
	})

	t.Run("Non-deauth athlete event is acknowledged without processing", func(t *testing.T) {
		mockTokens := &portstest.MockTokenStore{}
		tt := handleEventTestCase{
			method:      "POST",
			contentType: "application/json",
			payload: webhookproto.StravaWebhookJSON{
				AspectType:     "update",
				EventTime:      testEventTime,
				ObjectID:       testOwnerID,
				ObjectType:     "athlete",
				OwnerID:        testOwnerID,
				SubscriptionID: testSubscriptionID,
				Updates:        map[string]string{"profile": "updated"},
			},
			mockSubID:      testSubscriptionID,
			mockTokenStore: mockTokens,
			expectedStatus: http.StatusOK,
			expectedBody:   "acknowledged",
		}
		runHandleEventTest(t, &tt)

		if len(mockTokens.DeletedAthleteIDs) != 0 {
			t.Errorf("expected no DeleteTokens calls, got %v", mockTokens.DeletedAthleteIDs)
		}
	})
}

func TestHandler_EnrichmentBehavior_Create(t *testing.T) {
	log := gcplog.NewNoOpLogger()
	rawActivity := []byte(`{"id":12345,"name":"Morning Run","distance":5000}`)
	mockStrava := &portstest.MockStravaClient{FetchResult: rawActivity}
	mockPublisher := &portstest.MockPublisher{}

	handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, &portstest.MockSecretProvider{SubscriptionID: testSubscriptionID}, mockStrava, &portstest.MockTokenStore{}, log, nil)
	router := handler.RegisterRoutes()

	payload, marshalErr := json.Marshal(webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		ObjectType:     "activity",
		ObjectID:       testObjectID,
		OwnerID:        testOwnerID,
		EventTime:      testEventTime,
		SubscriptionID: testSubscriptionID,
	})
	if marshalErr != nil {
		t.Fatalf("Failed to marshal payload: %v", marshalErr)
	}

	req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	if len(mockPublisher.Published) != 1 {
		t.Fatalf("expected 1 published event, got %d", len(mockPublisher.Published))
	}

	enriched := mockPublisher.Published[0]
	if enriched.RawActivity == nil {
		t.Fatal("expected raw_activity to be set for CREATE event")
	}
	if !bytes.Equal(enriched.RawActivity, rawActivity) {
		t.Errorf("raw_activity = %s, want %s", string(enriched.RawActivity), string(rawActivity))
	}

	// Verify Strava client was called
	if len(mockStrava.FetchedIDs) != 1 || mockStrava.FetchedIDs[0] != testObjectID {
		t.Errorf("expected Strava fetch for activity %d, got %v", testObjectID, mockStrava.FetchedIDs)
	}
}

func TestHandler_EnrichmentBehavior_Update(t *testing.T) {
	log := gcplog.NewNoOpLogger()
	mockStrava := &portstest.MockStravaClient{}
	mockPublisher := &portstest.MockPublisher{}

	handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, &portstest.MockSecretProvider{SubscriptionID: testSubscriptionID}, mockStrava, &portstest.MockTokenStore{}, log, nil)
	router := handler.RegisterRoutes()

	payload, marshalErr := json.Marshal(webhookproto.StravaWebhookJSON{
		AspectType:     "update",
		ObjectType:     "activity",
		ObjectID:       testObjectID,
		OwnerID:        testOwnerID,
		EventTime:      testEventTime,
		SubscriptionID: testSubscriptionID,
		Updates:        map[string]string{"title": "New Title"},
	})
	if marshalErr != nil {
		t.Fatalf("Failed to marshal payload: %v", marshalErr)
	}

	req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	enriched := mockPublisher.Published[0]
	if enriched.RawActivity != nil {
		t.Error("expected no raw_activity for UPDATE event")
	}

	// Verify Strava client was NOT called
	if len(mockStrava.FetchedIDs) != 0 {
		t.Errorf("expected no Strava fetch for UPDATE, got %v", mockStrava.FetchedIDs)
	}
}

func TestHandler_EnrichmentBehavior_Delete(t *testing.T) {
	log := gcplog.NewNoOpLogger()
	mockStrava := &portstest.MockStravaClient{}
	mockPublisher := &portstest.MockPublisher{}

	handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, &portstest.MockSecretProvider{SubscriptionID: testSubscriptionID}, mockStrava, &portstest.MockTokenStore{}, log, nil)
	router := handler.RegisterRoutes()

	payload, marshalErr := json.Marshal(webhookproto.StravaWebhookJSON{
		AspectType:     "delete",
		ObjectType:     "activity",
		ObjectID:       testObjectID,
		OwnerID:        testOwnerID,
		EventTime:      testEventTime,
		SubscriptionID: testSubscriptionID,
	})
	if marshalErr != nil {
		t.Fatalf("Failed to marshal payload: %v", marshalErr)
	}

	req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	enriched := mockPublisher.Published[0]
	if enriched.RawActivity != nil {
		t.Error("expected no raw_activity for DELETE event")
	}

	if len(mockStrava.FetchedIDs) != 0 {
		t.Errorf("expected no Strava fetch for DELETE, got %v", mockStrava.FetchedIDs)
	}
}

func TestNewHandler_WithConfig(t *testing.T) {
	log := gcplog.NewNoOpLogger()
	mockPublisher := &portstest.MockPublisher{}
	mockSecrets := &portstest.MockSecretProvider{SubscriptionID: testSubscriptionID}
	mockStrava := &portstest.MockStravaClient{}
	mockTokens := &portstest.MockTokenStore{}

	// Create handler with a very small MaxRequestBodySize
	cfg := &HandlerConfig{MaxRequestBodySize: 512}
	handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, mockSecrets, mockStrava, mockTokens, log, cfg)
	router := handler.RegisterRoutes()

	// Build a valid JSON payload that exceeds 512 bytes
	payload := webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		EventTime:      testEventTime,
		ObjectID:       testObjectID,
		ObjectType:     "activity",
		OwnerID:        testOwnerID,
		SubscriptionID: testSubscriptionID,
		Updates:        map[string]string{"padding": strings.Repeat("x", 600)},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal payload: %v", err)
	}
	if int64(len(body)) <= 512 {
		t.Fatalf("Test payload must exceed 512 bytes, got %d", len(body))
	}

	req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d (body: %s)", http.StatusBadRequest, w.Code, w.Body.String())
	}
	errResp := parseErrorResponse(w.Body.String())
	if errResp == nil {
		t.Fatalf("expected JSON error response, got non-JSON: %q", w.Body.String())
	}
	if errResp.Code != ErrCodeReadFailed {
		t.Errorf("expected error code %q, got %q", ErrCodeReadFailed, errResp.Code)
	}
}

// Test health endpoints
func TestHandler_Health(t *testing.T) {
	log := gcplog.NewNoOpLogger()
	handler := NewHandler(&portstest.MockPublisher{}, &portstest.MockPublisher{}, &portstest.MockSecretProvider{}, &portstest.MockStravaClient{}, &portstest.MockTokenStore{}, log, nil)
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
		{
			name:           "GET / returns 405 (only HEAD is registered)",
			method:         "GET",
			path:           "/",
			expectedStatus: http.StatusMethodNotAllowed,
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
