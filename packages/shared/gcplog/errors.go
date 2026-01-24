package gcplog

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
)

// APIError represents a standardized API error with HTTP status and message.
type APIError struct {
	// Status is the HTTP status code to return
	Status int
	// Message is the user-facing error message
	Message string
	// Code is a machine-readable error code
	Code string
	// LogMessage is an optional internal message for logging (not sent to client)
	LogMessage string
}

// Error implements the error interface.
func (e APIError) Error() string {
	if e.LogMessage != "" {
		return e.LogMessage
	}
	return e.Message
}

// IsZero returns true if this is an uninitialized (zero-value) APIError.
// Use this instead of checking Status == 0 directly for clearer intent.
func (e APIError) IsZero() bool {
	return e.Status == 0 && e.Message == ""
}

// ErrorResponse is the JSON structure returned to clients for errors.
type ErrorResponse struct {
	Error     string         `json:"error"`
	Code      string         `json:"code,omitempty"`
	RequestID string         `json:"request_id,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
}

// Common API errors with standardized messages
var (
	ErrNotFound = APIError{
		Status:  http.StatusNotFound,
		Message: "Resource not found",
		Code:    "NOT_FOUND",
	}

	ErrBadRequest = APIError{
		Status:  http.StatusBadRequest,
		Message: "Invalid request",
		Code:    "BAD_REQUEST",
	}

	ErrMethodNotAllowed = APIError{
		Status:  http.StatusMethodNotAllowed,
		Message: "Method not allowed",
		Code:    "METHOD_NOT_ALLOWED",
	}

	ErrInternalServer = APIError{
		Status:     http.StatusInternalServerError,
		Message:    "Internal server error",
		LogMessage: "Internal server error - check logs for details",
		Code:       "INTERNAL_SERVER_ERROR",
	}

	ErrUnauthorized = APIError{
		Status:  http.StatusUnauthorized,
		Message: "Authentication failed",
		Code:    "UNAUTHORIZED",
	}

	ErrForbidden = APIError{
		Status:  http.StatusForbidden,
		Message: "Access denied",
		Code:    "FORBIDDEN",
	}
)

// NewAPIError creates a new API error with custom message.
func NewAPIError(status int, message string) APIError {
	return APIError{
		Status:  status,
		Message: message,
	}
}

// NewAPIErrorWithLog creates a new API error with separate log message.
func NewAPIErrorWithLog(status int, message, logMessage string) APIError {
	return APIError{
		Status:     status,
		Message:    message,
		LogMessage: logMessage,
	}
}

// WriteError writes an error response with proper HTTP headers.
func WriteError(w http.ResponseWriter, r *http.Request, err APIError, logger *slog.Logger) {
	requestID := middleware.GetReqID(r.Context())

	// Log error with context
	logAttrs := []any{
		"path", r.URL.Path,
		"method", r.Method,
		"status", err.Status,
		"request_id", requestID,
	}
	if err.Code != "" {
		logAttrs = append(logAttrs, "code", err.Code)
	}

	msg := err.LogMessage
	if msg == "" {
		msg = err.Message
	}

	if err.Status >= 500 {
		logger.Error("API Internal Error", append(logAttrs, "error", msg)...)
	} else {
		logger.Warn("API Request Error", append(logAttrs, "error", msg)...)
	}

	// Write JSON error response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.Status)

	response := ErrorResponse{
		Error:     err.Message,
		Code:      err.Code,
		RequestID: requestID,
	}
	if encErr := json.NewEncoder(w).Encode(response); encErr != nil {
		logger.Error("Failed to encode error response", "error", encErr, "request_id", requestID)
	}
}
