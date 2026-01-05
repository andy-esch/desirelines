package activities

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/apigateway/types/generated"
)

func TestRespondProtobuf(t *testing.T) {
	h := newTestHandler(t)

	t.Run("marshals protobuf with snake_case", func(t *testing.T) {
		// SportMetrics has fields like distance_meters which map to DistanceMeters in Go
		// proto definition: optional double distance_meters = 1;
		// generated Go: DistanceMeters *float64 `json:"distance_meters,omitempty"`

		dist := 100.0
		msg := &generated.DailyActivity{
			DistanceMeters: &dist,
			Activities:     5,
		}

		req := httptest.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()

		h.respondProtobuf(w, req, msg)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		if contentType := w.Header().Get("Content-Type"); contentType != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", contentType)
		}

		var response map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		// Verify snake_case keys (from proto definition) are used
		if _, ok := response["distance_meters"]; !ok {
			t.Error("expected 'distance_meters' key in JSON response")
		}
		if _, ok := response["distanceMeters"]; ok {
			t.Error("did not expect 'distanceMeters' (camelCase) key in JSON response")
		}

		if val, ok := response["activities"]; !ok || val.(float64) != 5 {
			t.Errorf("expected activities=5, got %v", val)
		}
	})

	t.Run("omits unpopulated optional fields", func(t *testing.T) {
		// DailyActivity with only Activities set
		// distance_meters is optional in proto, so nil pointer in Go should be omitted in JSON
		msg := &generated.DailyActivity{
			Activities: 10,
		}

		req := httptest.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()

		h.respondProtobuf(w, req, msg)

		var response map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if _, ok := response["distance_meters"]; ok {
			t.Error("expected 'distance_meters' to be omitted when nil")
		}
		if val, ok := response["activities"]; !ok || val.(float64) != 10 {
			t.Errorf("expected activities=10, got %v", val)
		}
	})

	t.Run("falls back to standard JSON for non-proto types", func(t *testing.T) {
		// Pass a regular struct that does not implement proto.Message
		type PlainStruct struct {
			CamelCaseField string `json:"camelCaseField"`
		}
		msg := PlainStruct{CamelCaseField: "value"}

		req := httptest.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()

		h.respondProtobuf(w, req, msg)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if _, ok := response["camelCaseField"]; !ok {
			t.Error("expected 'camelCaseField' key in fallback JSON response")
		}
	})

	t.Run("handles nil input", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()

		h.respondProtobuf(w, req, nil)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		// nil interface{} -> null in JSON
		if w.Body.String() != "null\n" && w.Body.String() != "null" {
			t.Errorf("expected 'null' response body, got %q", w.Body.String())
		}
	})
}
