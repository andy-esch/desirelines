// Package errors provides standardized error handling for the API Gateway.
package errors

import (
	"encoding/json"
	"log"
	"net/http"
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
// If corsHandler is provided, CORS headers will be set.
func WriteError(w http.ResponseWriter, r *http.Request, err APIError, corsHandler CORSHandler) {
	// Log internal message if provided
	if err.LogMessage != "" {
		log.Printf("API Error: %s (path: %s, method: %s)", err.LogMessage, r.URL.Path, r.Method)
	}

	// Set CORS headers if handler provided
	if corsHandler != nil {
		corsHandler.SetHeaders(w, r)
	}

	// Write JSON error response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.Status)

	response := ErrorResponse{Error: err.Message}
	if encErr := json.NewEncoder(w).Encode(response); encErr != nil {
		log.Printf("Error encoding error response: %v", encErr)
	}
}

// CORSHandler interface for setting CORS headers.
type CORSHandler interface {
	SetHeaders(w http.ResponseWriter, r *http.Request) bool
	HandlePreflight(w http.ResponseWriter, r *http.Request)
}
