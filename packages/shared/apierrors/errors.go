// Package apierrors provides standardized API error types and response writing
// for HTTP services. It is decoupled from any specific router or logging framework.
package apierrors

import "net/http"

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

// Common API errors with standardized messages.
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

	ErrRateLimited = APIError{
		Status:  http.StatusTooManyRequests,
		Message: "Rate limit exceeded",
		Code:    "RATE_LIMITED",
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
