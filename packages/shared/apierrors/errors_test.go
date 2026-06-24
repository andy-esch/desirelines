package apierrors

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/trace"
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
		{"ErrRateLimited", ErrRateLimited, http.StatusTooManyRequests, "RATE_LIMITED"},
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

		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}

		var response ErrorResponse
		if jsonErr := json.Unmarshal(w.Body.Bytes(), &response); jsonErr != nil {
			t.Fatalf("failed to unmarshal response: %v", jsonErr)
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
		ctx := WithRequestID(req.Context(), "test-req-id")
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
		if jsonErr := json.Unmarshal(w.Body.Bytes(), &response); jsonErr != nil {
			t.Fatalf("failed to unmarshal response: %v", jsonErr)
		}
		if response.Error != "Internal server error" {
			t.Errorf("response.Error = %q, want public message", response.Error)
		}
	})
}

func TestWriteCoded(t *testing.T) {
	logger := slog.Default()

	t.Run("writes status, message and code; hides log message", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		WriteCoded(w, req, logger, http.StatusBadRequest, "INVALID_THING",
			"Invalid thing", "SECRET: caller sent hunter2")

		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
		if body := w.Body.String(); strings.Contains(body, "SECRET") || strings.Contains(body, "hunter2") {
			t.Error("log message should not be exposed in response body")
		}

		var response ErrorResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if response.Error != "Invalid thing" {
			t.Errorf("response.Error = %q, want %q", response.Error, "Invalid thing")
		}
		if response.Code != "INVALID_THING" {
			t.Errorf("response.Code = %q, want %q", response.Code, "INVALID_THING")
		}
	})

	t.Run("empty code and log message omit code and fall back to message", func(t *testing.T) {
		// Mirrors the apigateway writeError call shape: no code, no separate log message.
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()

		WriteCoded(w, req, logger, http.StatusNotFound, "", "Activity not found", "")

		if w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
		}

		var response ErrorResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}
		if response.Error != "Activity not found" {
			t.Errorf("response.Error = %q, want %q", response.Error, "Activity not found")
		}
		if response.Code != "" {
			t.Errorf("response.Code = %q, want empty", response.Code)
		}
	})
}

func TestWriteError_IncludesTraceIDWhenSpanActive(t *testing.T) {
	logger := slog.Default()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)

	// Build a valid SpanContext with a known trace ID and attach to the
	// request context. Using ContextWithSpanContext avoids needing a full
	// TracerProvider; WriteError only reads SpanContextFromContext.
	traceID, err := trace.TraceIDFromHex("0af7651916cd43dd8448eb211c80319c")
	if err != nil {
		t.Fatalf("TraceIDFromHex: %v", err)
	}
	spanID, err := trace.SpanIDFromHex("b7ad6b7169203331")
	if err != nil {
		t.Fatalf("SpanIDFromHex: %v", err)
	}
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})
	req = req.WithContext(trace.ContextWithSpanContext(req.Context(), sc))
	w := httptest.NewRecorder()

	WriteError(w, req, ErrInternalServer, logger)

	var response ErrorResponse
	if jsonErr := json.Unmarshal(w.Body.Bytes(), &response); jsonErr != nil {
		t.Fatalf("failed to unmarshal response: %v", jsonErr)
	}
	want := "0af7651916cd43dd8448eb211c80319c"
	if response.TraceID != want {
		t.Errorf("response.TraceID = %q, want %q", response.TraceID, want)
	}
	if strings.Contains(response.TraceID, "projects/") {
		t.Errorf("response.TraceID = %q should be raw hex, not resource-name form", response.TraceID)
	}
}

func TestWriteError_OmitsTraceIDWhenNoSpan(t *testing.T) {
	logger := slog.Default()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WriteError(w, req, ErrBadRequest, logger)

	// With omitempty and no span, the field should be absent from JSON
	// (not present as an empty string). Check the raw body, not the
	// unmarshaled struct (which would show "" either way).
	body := w.Body.String()
	if strings.Contains(body, "traceId") {
		t.Errorf("response body should omit traceId when no span: %s", body)
	}
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

	want := `{"error":"Test error message","code":"TEST_CODE"}`
	if string(data) != want {
		t.Errorf("JSON = %s, want %s", string(data), want)
	}
}

func TestRequestIDFromContext(t *testing.T) {
	t.Run("returns empty when not set", func(t *testing.T) {
		ctx := t.Context()
		if got := RequestIDFromContext(ctx); got != "" {
			t.Errorf("RequestIDFromContext() = %q, want empty", got)
		}
	})

	t.Run("returns ID when set", func(t *testing.T) {
		ctx := WithRequestID(t.Context(), "req-123")
		if got := RequestIDFromContext(ctx); got != "req-123" {
			t.Errorf("RequestIDFromContext() = %q, want %q", got, "req-123")
		}
	})
}
