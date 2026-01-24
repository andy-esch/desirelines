package gcplog

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5/middleware"
)

func TestAPIError_Error(t *testing.T) {
	tests := []struct {
		name       string
		err        APIError
		wantString string
	}{
		{
			name:       "message only",
			err:        APIError{Status: 400, Message: "Bad request"},
			wantString: "Bad request",
		},
		{
			name:       "log message takes precedence",
			err:        APIError{Status: 500, Message: "Internal error", LogMessage: "Database connection failed"},
			wantString: "Database connection failed",
		},
		{
			name:       "empty log message uses message",
			err:        APIError{Status: 404, Message: "Not found", LogMessage: ""},
			wantString: "Not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.err.Error()
			if got != tt.wantString {
				t.Errorf("Error() = %q, want %q", got, tt.wantString)
			}
		})
	}
}

func TestAPIError_IsZero(t *testing.T) {
	tests := []struct {
		name     string
		err      APIError
		wantZero bool
	}{
		{
			name:     "zero value",
			err:      APIError{},
			wantZero: true,
		},
		{
			name:     "status only",
			err:      APIError{Status: 400},
			wantZero: false,
		},
		{
			name:     "message only",
			err:      APIError{Message: "error"},
			wantZero: false,
		},
		{
			name:     "status and message",
			err:      APIError{Status: 400, Message: "Bad request"},
			wantZero: false,
		},
		{
			name:     "full error",
			err:      APIError{Status: 500, Message: "Error", Code: "ERR", LogMessage: "log"},
			wantZero: false,
		},
		{
			name:     "predefined error",
			err:      ErrBadRequest,
			wantZero: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.err.IsZero()
			if got != tt.wantZero {
				t.Errorf("IsZero() = %v, want %v", got, tt.wantZero)
			}
		})
	}
}

func TestNewAPIError(t *testing.T) {
	err := NewAPIError(http.StatusBadRequest, "Invalid input")

	if err.Status != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", err.Status, http.StatusBadRequest)
	}
	if err.Message != "Invalid input" {
		t.Errorf("Message = %q, want %q", err.Message, "Invalid input")
	}
	if err.LogMessage != "" {
		t.Errorf("LogMessage = %q, want empty", err.LogMessage)
	}
}

func TestNewAPIErrorWithLog(t *testing.T) {
	err := NewAPIErrorWithLog(
		http.StatusInternalServerError,
		"Something went wrong",
		"Database query failed: connection refused",
	)

	if err.Status != http.StatusInternalServerError {
		t.Errorf("Status = %d, want %d", err.Status, http.StatusInternalServerError)
	}
	if err.Message != "Something went wrong" {
		t.Errorf("Message = %q, want %q", err.Message, "Something went wrong")
	}
	if err.LogMessage != "Database query failed: connection refused" {
		t.Errorf("LogMessage = %q, want %q", err.LogMessage, "Database query failed: connection refused")
	}
}

func TestPredefinedErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        APIError
		wantStatus int
		wantCode   string
	}{
		{"ErrNotFound", ErrNotFound, http.StatusNotFound, "NOT_FOUND"},
		{"ErrBadRequest", ErrBadRequest, http.StatusBadRequest, "BAD_REQUEST"},
		{"ErrMethodNotAllowed", ErrMethodNotAllowed, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED"},
		{"ErrInternalServer", ErrInternalServer, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR"},
		{"ErrUnauthorized", ErrUnauthorized, http.StatusUnauthorized, "UNAUTHORIZED"},
		{"ErrForbidden", ErrForbidden, http.StatusForbidden, "FORBIDDEN"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.err.Status != tt.wantStatus {
				t.Errorf("%s.Status = %d, want %d", tt.name, tt.err.Status, tt.wantStatus)
			}
			if tt.err.Message == "" {
				t.Errorf("%s.Message should not be empty", tt.name)
			}
			if tt.err.Code != tt.wantCode {
				t.Errorf("%s.Code = %q, want %q", tt.name, tt.err.Code, tt.wantCode)
			}
		})
	}
}

func TestWriteError(t *testing.T) {
	logger := slog.Default()

	t.Run("writes correct status and JSON with Code", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		err := ErrBadRequest
		WriteError(w, req, err, logger)

		// Check status code
		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}

		// Check response body
		var response ErrorResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if response.Error != err.Message {
			t.Errorf("response.Error = %q, want %q", response.Error, err.Message)
		}
		if response.Code != err.Code {
			t.Errorf("response.Code = %q, want %q", response.Code, err.Code)
		}
	})

	t.Run("includes request ID from context", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		// Manually set request ID in context (simulating middleware)
		ctx := context.WithValue(req.Context(), middleware.RequestIDKey, "test-req-id")
		req = req.WithContext(ctx)
		w := httptest.NewRecorder()

		WriteError(w, req, ErrInternalServer, logger)

		var response ErrorResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if response.RequestID != "test-req-id" {
			t.Errorf("response.RequestID = %q, want %q", response.RequestID, "test-req-id")
		}
	})

	t.Run("does not expose log message in response", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		err := NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Internal server error",
			"SECRET: database password is hunter2",
		)
		WriteError(w, req, err, logger)

		body := w.Body.String()
		if strings.Contains(body, "SECRET") || strings.Contains(body, "hunter2") {
			t.Error("log message should not be exposed in response body")
		}

		var response ErrorResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if response.Error != "Internal server error" {
			t.Errorf("response.Error = %q, want public message", response.Error)
		}
	})
}

func TestErrorResponse_JSONFormat(t *testing.T) {
	response := ErrorResponse{
		Error: "Test error message",
		Code:  "TEST_CODE",
	}

	data, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	// Should produce {"error":"Test error message","code":"TEST_CODE"}
	// Note: RequestID and Details omitted because they are empty
	want := `{"error":"Test error message","code":"TEST_CODE"}`
	if string(data) != want {
		t.Errorf("JSON = %s, want %s", string(data), want)
	}
}
