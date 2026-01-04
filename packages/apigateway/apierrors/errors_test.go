package apierrors

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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
	}{
		{"ErrNotFound", ErrNotFound, http.StatusNotFound},
		{"ErrBadRequest", ErrBadRequest, http.StatusBadRequest},
		{"ErrMethodNotAllowed", ErrMethodNotAllowed, http.StatusMethodNotAllowed},
		{"ErrInternalServer", ErrInternalServer, http.StatusInternalServerError},
		{"ErrUnauthorized", ErrUnauthorized, http.StatusUnauthorized},
		{"ErrForbidden", ErrForbidden, http.StatusForbidden},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.err.Status != tt.wantStatus {
				t.Errorf("%s.Status = %d, want %d", tt.name, tt.err.Status, tt.wantStatus)
			}
			if tt.err.Message == "" {
				t.Errorf("%s.Message should not be empty", tt.name)
			}
		})
	}
}

func TestWriteError(t *testing.T) {
	t.Run("writes correct status and JSON", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		err := NewAPIError(http.StatusBadRequest, "Invalid year format")
		WriteError(w, req, err)

		// Check status code
		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}

		// Check content type
		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want %q", ct, "application/json")
		}

		// Check response body
		var response ErrorResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if response.Error != "Invalid year format" {
			t.Errorf("response.Error = %q, want %q", response.Error, "Invalid year format")
		}
	})

	t.Run("works with nil CORS handler", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		err := NewAPIError(http.StatusNotFound, "Not found")
		WriteError(w, req, err)

		if w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
		}

		var response ErrorResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if response.Error != "Not found" {
			t.Errorf("response.Error = %q, want %q", response.Error, "Not found")
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
		WriteError(w, req, err)

		body := w.Body.String()
		if contains(body, "SECRET") || contains(body, "hunter2") {
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

	t.Run("handles all status codes", func(t *testing.T) {
		statusCodes := []int{
			http.StatusBadRequest,
			http.StatusUnauthorized,
			http.StatusForbidden,
			http.StatusNotFound,
			http.StatusMethodNotAllowed,
			http.StatusInternalServerError,
			http.StatusServiceUnavailable,
		}

		for _, code := range statusCodes {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			w := httptest.NewRecorder()

			err := NewAPIError(code, "Test error")
			WriteError(w, req, err)

			if w.Code != code {
				t.Errorf("status for %d = %d", code, w.Code)
			}
		}
	})
}

func TestErrorResponse_JSONFormat(t *testing.T) {
	response := ErrorResponse{Error: "Test error message"}

	data, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	// Should produce {"error":"Test error message"}
	want := `{"error":"Test error message"}`
	if string(data) != want {
		t.Errorf("JSON = %s, want %s", string(data), want)
	}
}

// Helper function
func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
