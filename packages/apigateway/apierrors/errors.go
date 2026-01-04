// Package apierrors provides standardized error handling for the API Gateway.
package apierrors

import (
	"encoding/json"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/logger"
)

// APIError represents a standardized API error with HTTP status and message.
type APIError struct {
	// Status is the HTTP status code to return
	Status int
	// Message is the user-facing error message
	Message string
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

// ErrorResponse is the JSON structure returned to clients for errors.
type ErrorResponse struct {
	Error string `json:"error"`
}

// Common API errors with standardized messages
var (
	ErrNotFound = APIError{
		Status:  http.StatusNotFound,
		Message: "Resource not found",
	}

	ErrBadRequest = APIError{
		Status:  http.StatusBadRequest,
		Message: "Invalid request",
	}

	ErrMethodNotAllowed = APIError{
		Status:  http.StatusMethodNotAllowed,
		Message: "Method not allowed",
	}

	ErrInternalServer = APIError{
		Status:     http.StatusInternalServerError,
		Message:    "Internal server error",
		LogMessage: "Internal server error - check logs for details",
	}

	ErrUnauthorized = APIError{
		Status:  http.StatusUnauthorized,
		Message: "Authentication failed",
	}

	ErrForbidden = APIError{
		Status:  http.StatusForbidden,
		Message: "Access denied",
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
func WriteError(w http.ResponseWriter, r *http.Request, err APIError) {
	// Log internal message if provided
	// Note: Uses r.URL.Path (not r.URL.String()) to avoid logging query parameters
	// which may contain sensitive data like tokens or user information
	if err.LogMessage != "" {
		logger.Logger.Error("API Error",
			"message", err.LogMessage,
			"path", r.URL.Path,
			"method", r.Method,
			"status", err.Status)
	}

	// Write JSON error response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.Status)

	response := ErrorResponse{Error: err.Message}
	if encErr := json.NewEncoder(w).Encode(response); encErr != nil {
		logger.Logger.Error("Failed to encode error response", "error", encErr)
	}
}

// CORSHandler interface for setting CORS headers.
type CORSHandler interface {
	SetHeaders(w http.ResponseWriter, r *http.Request) bool
	HandlePreflight(w http.ResponseWriter, r *http.Request)
}
