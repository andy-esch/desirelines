// Package apigateway provides HTTP API handlers for serving chart data
// from Cloud Storage to the web frontend.
package apigateway

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/andy-esch/desirelines/packages/apigateway/storage"
	"github.com/andy-esch/desirelines/packages/apigateway/types"
)

// Handler orchestrates API Gateway request processing.
type Handler struct {
	storage storage.Client
}

// NewHandler creates a new API Gateway handler.
func NewHandler(ctx context.Context) (*Handler, error) {
	var storageClient storage.Client
	var err error

	// Check DATA_SOURCE environment variable
	dataSource := getEnvOrDefault("DATA_SOURCE", "cloud-storage")

	switch dataSource {
	case "local-fixtures":
		basePath := getEnvOrDefault("LOCAL_FIXTURES_PATH", "data/fixtures")
		storageClient, err = storage.NewLocalStorageClient(basePath)
		if err != nil {
			return nil, fmt.Errorf("failed to create local storage client: %w", err)
		}
		log.Printf("Using local fixtures from: %s", basePath)
	case "cloud-storage":
		storageClient, err = storage.NewCloudStorageClient(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to create cloud storage client: %w", err)
		}
		log.Println("Using Cloud Storage")
	default:
		return nil, fmt.Errorf("invalid DATA_SOURCE: %s (expected: local-fixtures or cloud-storage)", dataSource)
	}

	return &Handler{
		storage: storageClient,
	}, nil
}

// getEnvOrDefault returns environment variable value or default if not set.
func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// NewHandlerWithStorage is a constructor for testing that allows injecting a mock storage client.
func NewHandlerWithStorage(storageClient storage.Client) *Handler {
	return &Handler{
		storage: storageClient,
	}
}

// ServeHTTP implements http.Handler interface.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Handle CORS preflight
	if r.Method == http.MethodOptions {
		h.handleCORS(w, r)
		return
	}

	// Only allow GET requests
	if r.Method != http.MethodGet {
		h.respondError(w, r, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/")
	log.Printf("API request: %s %s", r.Method, path)

	// Route requests
	switch {
	case path == "health":
		h.handleHealth(w, r)
	case strings.HasPrefix(path, "activities/"):
		h.handleActivities(w, r, path)
	default:
		h.respondError(w, r, http.StatusNotFound, "Not found")
	}
}

// handleHealth returns API health status.
func (h *Handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	response := types.HealthResponse{
		Status: "healthy",
	}
	h.respondJSON(w, r, http.StatusOK, response)
}

// handleActivities routes activity data requests.
func (h *Handler) handleActivities(w http.ResponseWriter, r *http.Request, path string) {
	// Parse path: activities/{year}/{data_type}
	parts := strings.Split(path, "/")
	if len(parts) != 3 {
		h.respondError(w, r, http.StatusBadRequest, "Invalid path format. Expected: /activities/{year}/{type}")
		return
	}

	year := parts[1]
	dataType := parts[2]

	// Validate data type
	var blobPath string
	switch dataType {
	case "summary":
		blobPath = fmt.Sprintf("activities/%s/summary_activities.json", year)
	case "distances":
		blobPath = fmt.Sprintf("activities/%s/distances.json", year)
	default:
		h.respondError(w, r, http.StatusBadRequest, fmt.Sprintf("Invalid data type: %s", dataType))
		return
	}

	// Fetch data from storage
	data, err := h.storage.ReadJSON(r.Context(), blobPath)
	if err != nil {
		if err == storage.ErrNotFound {
			h.respondError(w, r, http.StatusNotFound, fmt.Sprintf("Data not found for %s/%s", year, dataType))
			return
		}
		log.Printf("Error reading blob %s: %v", blobPath, err)
		h.respondError(w, r, http.StatusInternalServerError, "Internal server error")
		return
	}

	// Respond with data (already parsed JSON)
	h.respondJSONRaw(w, r, http.StatusOK, data)
}

// handleCORS responds to CORS preflight requests.
func (h *Handler) handleCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")

	// Set CORS headers with origin validation
	h.setCORSHeaders(w, origin)

	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Max-Age", "3600")
	w.WriteHeader(http.StatusNoContent)
}

// setCORSHeaders sets appropriate CORS headers based on the request origin.
func (h *Handler) setCORSHeaders(w http.ResponseWriter, origin string) {
	// Get allowed origins from environment variable (comma-separated)
	// Example: ALLOWED_ORIGINS="https://desirelines-dev.web.app,http://localhost:5173"
	allowedOriginsEnv := os.Getenv("ALLOWED_ORIGINS")

	if allowedOriginsEnv == "" {
		// Secure by default: no CORS headers if not configured
		// This will cause browser to block cross-origin requests
		log.Printf("CORS: ALLOWED_ORIGINS not set, blocking all cross-origin requests")
		return
	}

	// Parse comma-separated origins
	allowedOrigins := strings.Split(allowedOriginsEnv, ",")

	// Trim whitespace from each origin
	for i := range allowedOrigins {
		allowedOrigins[i] = strings.TrimSpace(allowedOrigins[i])
	}

	// Check if origin is in whitelist
	for _, allowed := range allowedOrigins {
		if origin == allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			return
		}
	}

	// No CORS header if origin not allowed (browser will block)
	log.Printf("CORS: Origin not allowed: %s (allowed: %s)", origin, allowedOriginsEnv)
}

// respondJSON writes a JSON response with CORS headers.
func (h *Handler) respondJSON(w http.ResponseWriter, r *http.Request, status int, data interface{}) {
	origin := r.Header.Get("Origin")
	h.setCORSHeaders(w, origin)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON response: %v", err)
	}
}

// respondJSONRaw writes pre-marshaled JSON data with CORS headers.
func (h *Handler) respondJSONRaw(w http.ResponseWriter, r *http.Request, status int, data interface{}) {
	origin := r.Header.Get("Origin")
	h.setCORSHeaders(w, origin)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300") // 5 minutes
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON response: %v", err)
	}
}

// respondError writes an error response with CORS headers.
func (h *Handler) respondError(w http.ResponseWriter, r *http.Request, status int, message string) {
	response := types.ErrorResponse{
		Error: message,
	}
	h.respondJSON(w, r, status, response)
}
