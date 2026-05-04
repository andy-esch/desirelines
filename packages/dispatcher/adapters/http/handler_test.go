package httpadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/apierrors"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
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
func parseErrorResponse(body string) *apierrors.ErrorResponse {
	var resp apierrors.ErrorResponse
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

			handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, mockSecrets, mockStrava, &portstest.MockTokenStore{}, portstest.NewAllowAllMockAllowlist(), log, nil)
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
		{
			// Stray webhook for an athlete who holds a Strava OAuth grant
			// against this app but is not allowlisted in this environment.
			// Acked silently — Strava should not retry, and we never call
			// Strava since there's nothing to fetch.
			name:           "Non-allowlisted owner acknowledged without fetching",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      testSubscriptionID,
			mockAllowlist:  &portstest.MockAllowlist{Allowed: false},
			expectedStatus: http.StatusOK,
			expectedBody:   "acknowledged",
		},
		{
			// Orphan: athlete IS allowlisted but Firestore tokens are
			// missing. Real bug worth alerting on. We still ack so Strava
			// stops retrying — no amount of retry will materialize the
			// missing tokens.
			name:           "Allowlisted owner with no tokens (orphan) acknowledged",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      testSubscriptionID,
			mockAllowlist:  portstest.NewAllowAllMockAllowlist(),
			stravaErr:      ports.ErrTokenNotFound,
			expectedStatus: http.StatusOK,
			expectedBody:   "acknowledged",
		},
		{
			// Same as above but with the *wrapped* error the real Strava
			// client emits (see strava/client.go: `get tokens for athlete %d: %w`).
			// Locks in errors.Is unwrapping — a future refactor that loses
			// %w would silently route orphans to the 500 default branch.
			name:           "Allowlisted owner with wrapped ErrTokenNotFound (orphan) acknowledged",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      testSubscriptionID,
			mockAllowlist:  portstest.NewAllowAllMockAllowlist(),
			stravaErr:      fmt.Errorf("get tokens for athlete %d: %w", int64(testOwnerID), ports.ErrTokenNotFound),
			expectedStatus: http.StatusOK,
			expectedBody:   "acknowledged",
		},
		{
			// Transient allowlist failure (Firestore unreachable, etc.) —
			// fail-closed with 500 so Strava retries within its 3-attempt
			// cap. Better than silently dropping a legitimate user's event
			// because the lookup hiccupped.
			name:           "Allowlist read error returns 500",
			method:         "POST",
			contentType:    "application/json",
			payload:        validPayload,
			mockSubID:      testSubscriptionID,
			mockAllowlist:  &portstest.MockAllowlist{Err: errors.New("firestore unavailable")},
			expectedStatus: http.StatusInternalServerError,
			expectedCode:   "ALLOWLIST_CHECK_FAILED",
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
	mockAllowlist       *portstest.MockAllowlist
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

func allowlistOrDefault(a *portstest.MockAllowlist) *portstest.MockAllowlist {
	if a != nil {
		return a
	}
	return portstest.NewAllowAllMockAllowlist()
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

	handler := NewHandler(mockPublisher, mockDeauthPublisher, mockSecrets, mockStrava, mockTokenStoreOrDefault(tt.mockTokenStore), allowlistOrDefault(tt.mockAllowlist), log, nil)
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

// TestHandler_OwnerCheck_StrayDoesNotCallStrava asserts the allowlist guard
// short-circuits before any Strava API call. This is the headline win of the
// guard: no Strava rate-limit budget consumed for stray webhooks.
func TestHandler_OwnerCheck_StrayDoesNotCallStrava(t *testing.T) {
	log := gcplog.NewNoOpLogger()
	mockStrava := &portstest.MockStravaClient{}
	mockPublisher := &portstest.MockPublisher{}
	mockAllowlist := &portstest.MockAllowlist{Allowed: false}

	handler := NewHandler(
		mockPublisher,
		&portstest.MockPublisher{},
		&portstest.MockSecretProvider{SubscriptionID: testSubscriptionID},
		mockStrava,
		&portstest.MockTokenStore{},
		mockAllowlist,
		log,
		nil,
	)
	router := handler.RegisterRoutes()

	payload, err := json.Marshal(webhookproto.StravaWebhookJSON{
		AspectType:     "create",
		ObjectType:     "activity",
		ObjectID:       testObjectID,
		OwnerID:        testOwnerID,
		EventTime:      testEventTime,
		SubscriptionID: testSubscriptionID,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
	if mockStrava.FetchedCount() != 0 {
		t.Errorf("Strava was called %d times, want 0 (stray should short-circuit)", mockStrava.FetchedCount())
	}
	if mockPublisher.PublishedCount() != 0 {
		t.Errorf("Publisher called %d times, want 0", mockPublisher.PublishedCount())
	}
	if mockAllowlist.CalledCount() != 1 {
		t.Errorf("Allowlist called %d times, want 1", mockAllowlist.CalledCount())
	}
	wantOwnerID := strconv.FormatInt(testOwnerID, 10)
	if len(mockAllowlist.CalledWith) != 1 || mockAllowlist.CalledWith[0] != wantOwnerID {
		t.Errorf("Allowlist.CalledWith = %v, want [%s]", mockAllowlist.CalledWith, wantOwnerID)
	}
}

// TestHandler_OwnerCheck_DeauthBypassesAllowlist asserts that athlete deauth
// events run regardless of allowlist membership. Deauthorizing a stray
// athlete is exactly how we drain a zombie subscription, so the allowlist
// must NOT gate this path.
func TestHandler_OwnerCheck_DeauthBypassesAllowlist(t *testing.T) {
	log := gcplog.NewNoOpLogger()
	mockTokens := &portstest.MockTokenStore{}
	mockDeauth := &portstest.MockPublisher{}
	denyingAllowlist := &portstest.MockAllowlist{Allowed: false}

	handler := NewHandler(
		&portstest.MockPublisher{},
		mockDeauth,
		&portstest.MockSecretProvider{SubscriptionID: testSubscriptionID},
		&portstest.MockStravaClient{},
		mockTokens,
		denyingAllowlist,
		log,
		nil,
	)
	router := handler.RegisterRoutes()

	payload, err := json.Marshal(webhookproto.StravaWebhookJSON{
		AspectType:     "update",
		ObjectType:     "athlete",
		ObjectID:       testOwnerID,
		OwnerID:        testOwnerID,
		EventTime:      testEventTime,
		SubscriptionID: testSubscriptionID,
		Updates:        map[string]string{"authorized": "false"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
	if mockTokens.DeletedCount() != 1 {
		t.Errorf("DeleteTokens called %d times, want 1 (deauth must clean up regardless of allowlist)", mockTokens.DeletedCount())
	}
	if len(mockDeauth.Published) != 1 {
		t.Errorf("Deauth publisher called %d times, want 1", len(mockDeauth.Published))
	}
	if denyingAllowlist.CalledCount() != 0 {
		t.Errorf("Allowlist called %d times, want 0 (deauth must bypass)", denyingAllowlist.CalledCount())
	}
}

func TestHandler_EnrichmentBehavior_Create(t *testing.T) {
	log := gcplog.NewNoOpLogger()
	rawActivity := []byte(`{"id":12345,"name":"Morning Run","distance":5000}`)
	mockStrava := &portstest.MockStravaClient{FetchResult: rawActivity}
	mockPublisher := &portstest.MockPublisher{}

	handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, &portstest.MockSecretProvider{SubscriptionID: testSubscriptionID}, mockStrava, &portstest.MockTokenStore{}, portstest.NewAllowAllMockAllowlist(), log, nil)
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

	handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, &portstest.MockSecretProvider{SubscriptionID: testSubscriptionID}, mockStrava, &portstest.MockTokenStore{}, portstest.NewAllowAllMockAllowlist(), log, nil)
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

	handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, &portstest.MockSecretProvider{SubscriptionID: testSubscriptionID}, mockStrava, &portstest.MockTokenStore{}, portstest.NewAllowAllMockAllowlist(), log, nil)
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
	handler := NewHandler(mockPublisher, &portstest.MockPublisher{}, mockSecrets, mockStrava, mockTokens, portstest.NewAllowAllMockAllowlist(), log, cfg)
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
	} else if errResp.Code != ErrCodeReadFailed {
		t.Errorf("expected error code %q, got %q", ErrCodeReadFailed, errResp.Code)
	}
}

// Test health endpoints
func TestHandler_Health(t *testing.T) {
	log := gcplog.NewNoOpLogger()
	handler := NewHandler(&portstest.MockPublisher{}, &portstest.MockPublisher{}, &portstest.MockSecretProvider{}, &portstest.MockStravaClient{}, &portstest.MockTokenStore{}, portstest.NewAllowAllMockAllowlist(), log, nil)
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

func TestStampWebhookIDsOnSpan(t *testing.T) {
	// Pins down the type-aware stamping rule: athlete_id is always meaningful
	// (OwnerId is always the Strava athlete ID), but activity_id is ONLY
	// meaningful when the event is OBJECT_TYPE_ACTIVITY. For athlete/deauth
	// events, ObjectId == OwnerId, so stamping it as desirelines.activity_id
	// would silently misclassify the trace.
	tests := []struct {
		name           string
		objectType     generated.ObjectType
		objectID       int64
		ownerID        int64
		wantActivityID int64 // 0 means "must NOT be set"
		wantAthleteID  int64
	}{
		{
			name:           "activity event stamps both ids",
			objectType:     generated.ObjectType_OBJECT_TYPE_ACTIVITY,
			objectID:       1234567890,
			ownerID:        98765,
			wantActivityID: 1234567890,
			wantAthleteID:  98765,
		},
		{
			name:           "athlete event stamps only athlete_id",
			objectType:     generated.ObjectType_OBJECT_TYPE_ATHLETE,
			objectID:       98765, // Strava sends athlete_id as ObjectId for athlete events
			ownerID:        98765,
			wantActivityID: 0, // must not be present on the span
			wantAthleteID:  98765,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sr := tracetest.NewSpanRecorder()
			tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
			ctx, span := tp.Tracer("test").Start(context.Background(), "test")

			stampWebhookIDsOnSpan(ctx, &generated.WebhookEvent{
				ObjectType: tt.objectType,
				ObjectId:   tt.objectID,
				OwnerId:    tt.ownerID,
			})
			span.End()

			ended := sr.Ended()
			if len(ended) != 1 {
				t.Fatalf("expected 1 ended span, got %d", len(ended))
			}
			attrs := ended[0].Attributes()

			var gotActivityID, gotAthleteID int64
			var sawActivityAttr bool
			for _, a := range attrs {
				switch string(a.Key) {
				case "desirelines.activity_id":
					sawActivityAttr = true
					gotActivityID = a.Value.AsInt64()
				case "desirelines.athlete_id":
					gotAthleteID = a.Value.AsInt64()
				}
			}

			if tt.wantActivityID == 0 {
				if sawActivityAttr {
					t.Errorf("desirelines.activity_id set to %d on %v event; should be omitted", gotActivityID, tt.objectType)
				}
			} else if !sawActivityAttr || gotActivityID != tt.wantActivityID {
				t.Errorf("desirelines.activity_id = %d (set=%v), want %d", gotActivityID, sawActivityAttr, tt.wantActivityID)
			}
			if gotAthleteID != tt.wantAthleteID {
				t.Errorf("desirelines.athlete_id = %d, want %d", gotAthleteID, tt.wantAthleteID)
			}
		})
	}
}

func TestStampWebhookIDsOnSpan_NoActiveSpanIsNoOp(t *testing.T) {
	// Defensive: must not panic when called with a context that has no span.
	stampWebhookIDsOnSpan(context.Background(), &generated.WebhookEvent{
		ObjectType: generated.ObjectType_OBJECT_TYPE_ACTIVITY,
		ObjectId:   1,
		OwnerId:    2,
	})
}
