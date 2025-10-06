// Package types defines API response structures.
package types

// HealthResponse is the response for the /health endpoint.
type HealthResponse struct {
	Status string `json:"status"`
}

// ErrorResponse is the response for error cases.
type ErrorResponse struct {
	Error string `json:"error"`
}
