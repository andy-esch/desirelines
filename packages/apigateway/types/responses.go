// Package types defines API response structures.
// revive:disable:var-naming
package types

// HealthResponse is the response for the /health endpoint.
type HealthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database,omitempty"`
}

// ErrorResponse is the response for error cases.
type ErrorResponse struct {
	Error string `json:"error"`
}
