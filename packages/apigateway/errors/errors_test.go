package errors

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAPIError_Error(t *testing.T) {
	tests := []struct {
		name           string
		apiError       APIError
		expectedString string
	}{
		{
			name: "returns LogMessage when set",
			apiError: APIError{
				Status:     http.StatusInternalServerError,
				Message:    "Internal error",
				LogMessage: "Detailed internal error with stack trace",
			},
			expectedString: "Detailed internal error with stack trace",
		},
		{
			name: "returns Message when LogMessage is empty",
			apiError: APIError{
				Status:     http.StatusBadRequest,
				Message:    "Invalid input",
				LogMessage: "",
			},
			expectedString: "Invalid input",
		},
		{
			name: "returns Message when LogMessage not provided",
			apiError: APIError{
				Status:  http.StatusNotFound,
				Message: "Not found",
			},
			expectedString: "Not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.apiError.Error()
			if result != tt.expectedString {
				t.Errorf("expected %q, got %q", tt.expectedString, result)
			}
		})
	}
}

func TestNewAPIError(t *testing.T) {
	status := http.StatusTeapot
	message := "I'm a teapot"

	err := NewAPIError(status, message)

	if err.Status != status {
		t.Errorf("expected Status=%d, got %d", status, err.Status)
	}

	if err.Message != message {
		t.Errorf("expected Message=%q, got %q", message, err.Message)
	}

	if err.LogMessage != "" {
		t.Errorf("expected LogMessage to be empty, got %q", err.LogMessage)
	}
}

func TestNewAPIErrorWithLog(t *testing.T) {
	status := http.StatusInternalServerError
	message := "Something went wrong"
	logMessage := "Database connection failed: timeout after 30s"

	err := NewAPIErrorWithLog(status, message, logMessage)

	if err.Status != status {
		t.Errorf("expected Status=%d, got %d", status, err.Status)
	}

	if err.Message != message {
		t.Errorf("expected Message=%q, got %q", message, err.Message)
	}

	if err.LogMessage != logMessage {
		t.Errorf("expected LogMessage=%q, got %q", logMessage, err.LogMessage)
	}
}

// Mock CORS handler for testing
type mockCORSHandler struct {
	setHeadersCalled bool
}

func (m *mockCORSHandler) SetHeaders(w http.ResponseWriter, r *http.Request) bool {
	m.setHeadersCalled = true
	return true
}

func (m *mockCORSHandler) HandlePreflight(w http.ResponseWriter, r *http.Request) {
	// Not needed for these tests
}

func TestWriteError_WithCORS(t *testing.T) {
	err := NewAPIError(http.StatusBadRequest, "Invalid request")
	mockCORS := &mockCORSHandler{}

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()

	WriteError(w, req, err, mockCORS)

	// Check CORS handler was called
	if !mockCORS.setHeadersCalled {
		t.Error("expected CORS SetHeaders to be called")
	}

	// Check status code
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	// Check Content-Type header
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type=application/json, got %q", contentType)
	}

	// Check response body
	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Error != "Invalid request" {
		t.Errorf("expected error message=%q, got %q", "Invalid request", response.Error)
	}
}

func TestWriteError_WithoutCORS(t *testing.T) {
	err := NewAPIError(http.StatusNotFound, "Resource not found")

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()

	// Pass nil for CORS handler
	WriteError(w, req, err, nil)

	// Check status code
	if w.Code != http.StatusNotFound {
		t.Errorf("expected status %d, got %d", http.StatusNotFound, w.Code)
	}

	// Check Content-Type header
	contentType := w.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("expected Content-Type=application/json, got %q", contentType)
	}

	// Check response body
	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if response.Error != "Resource not found" {
		t.Errorf("expected error message=%q, got %q", "Resource not found", response.Error)
	}
}

func TestWriteError_WithLogMessage(t *testing.T) {
	err := NewAPIErrorWithLog(
		http.StatusInternalServerError,
		"Internal server error",
		"Database connection failed",
	)

	req := httptest.NewRequest("POST", "/api/data?token=secret123", nil)
	w := httptest.NewRecorder()

	WriteError(w, req, err, nil)

	// Note: We can't easily test log output, but we can verify the response
	// doesn't include the log message

	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Response should contain Message, not LogMessage
	if response.Error != "Internal server error" {
		t.Errorf("expected error message=%q, got %q", "Internal server error", response.Error)
	}

	// Should NOT contain log message
	if response.Error == "Database connection failed" {
		t.Error("response should not contain log message")
	}
}

func TestWriteError_MultipleErrors(t *testing.T) {
	tests := []struct {
		name           string
		err            APIError
		expectedStatus int
		expectedMsg    string
	}{
		{
			name:           "bad request",
			err:            ErrBadRequest,
			expectedStatus: http.StatusBadRequest,
			expectedMsg:    "Invalid request",
		},
		{
			name:           "not found",
			err:            ErrNotFound,
			expectedStatus: http.StatusNotFound,
			expectedMsg:    "Resource not found",
		},
		{
			name:           "unauthorized",
			err:            ErrUnauthorized,
			expectedStatus: http.StatusUnauthorized,
			expectedMsg:    "Authentication failed",
		},
		{
			name:           "forbidden",
			err:            ErrForbidden,
			expectedStatus: http.StatusForbidden,
			expectedMsg:    "Access denied",
		},
		{
			name:           "method not allowed",
			err:            ErrMethodNotAllowed,
			expectedStatus: http.StatusMethodNotAllowed,
			expectedMsg:    "Method not allowed",
		},
		{
			name:           "internal server error",
			err:            ErrInternalServer,
			expectedStatus: http.StatusInternalServerError,
			expectedMsg:    "Internal server error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test", nil)
			w := httptest.NewRecorder()

			WriteError(w, req, tt.err, nil)

			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			var response ErrorResponse
			if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			if response.Error != tt.expectedMsg {
				t.Errorf("expected message=%q, got %q", tt.expectedMsg, response.Error)
			}
		})
	}
}

func TestPredefinedErrors(t *testing.T) {
	tests := []struct {
		name           string
		err            APIError
		expectedStatus int
		expectedMsg    string
		hasLogMessage  bool
	}{
		{
			name:           "ErrNotFound",
			err:            ErrNotFound,
			expectedStatus: http.StatusNotFound,
			expectedMsg:    "Resource not found",
			hasLogMessage:  false,
		},
		{
			name:           "ErrBadRequest",
			err:            ErrBadRequest,
			expectedStatus: http.StatusBadRequest,
			expectedMsg:    "Invalid request",
			hasLogMessage:  false,
		},
		{
			name:           "ErrMethodNotAllowed",
			err:            ErrMethodNotAllowed,
			expectedStatus: http.StatusMethodNotAllowed,
			expectedMsg:    "Method not allowed",
			hasLogMessage:  false,
		},
		{
			name:           "ErrInternalServer",
			err:            ErrInternalServer,
			expectedStatus: http.StatusInternalServerError,
			expectedMsg:    "Internal server error",
			hasLogMessage:  true,
		},
		{
			name:           "ErrUnauthorized",
			err:            ErrUnauthorized,
			expectedStatus: http.StatusUnauthorized,
			expectedMsg:    "Authentication failed",
			hasLogMessage:  false,
		},
		{
			name:           "ErrForbidden",
			err:            ErrForbidden,
			expectedStatus: http.StatusForbidden,
			expectedMsg:    "Access denied",
			hasLogMessage:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.err.Status != tt.expectedStatus {
				t.Errorf("expected Status=%d, got %d", tt.expectedStatus, tt.err.Status)
			}

			if tt.err.Message != tt.expectedMsg {
				t.Errorf("expected Message=%q, got %q", tt.expectedMsg, tt.err.Message)
			}

			if tt.hasLogMessage && tt.err.LogMessage == "" {
				t.Error("expected LogMessage to be set")
			}

			if !tt.hasLogMessage && tt.err.LogMessage != "" {
				t.Errorf("expected LogMessage to be empty, got %q", tt.err.LogMessage)
			}
		})
	}
}

func TestErrorResponse_JSON(t *testing.T) {
	response := ErrorResponse{Error: "Test error message"}

	data, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("failed to marshal ErrorResponse: %v", err)
	}

	expected := `{"error":"Test error message"}`
	if string(data) != expected {
		t.Errorf("expected JSON=%q, got %q", expected, string(data))
	}

	// Test unmarshal
	var decoded ErrorResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal ErrorResponse: %v", err)
	}

	if decoded.Error != response.Error {
		t.Errorf("expected decoded error=%q, got %q", response.Error, decoded.Error)
	}
}
