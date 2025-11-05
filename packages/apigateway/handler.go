// Package apigateway provides HTTP API handlers for serving chart data
// from Cloud Storage to the web frontend.
package apigateway

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/andy-esch/desirelines/packages/apigateway/cors"
	"github.com/andy-esch/desirelines/packages/apigateway/errors"
	"github.com/andy-esch/desirelines/packages/apigateway/middleware"
	"github.com/andy-esch/desirelines/packages/apigateway/storage"
	"github.com/andy-esch/desirelines/packages/apigateway/types"
)

// AuthMiddleware defines the interface for authentication middleware.
type AuthMiddleware interface {
	Middleware(next http.Handler) http.Handler
}

// Handler orchestrates API Gateway request processing.
type Handler struct {
	storage        storage.Client
	authMiddleware AuthMiddleware
	corsHandler    *cors.Handler
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

	// Initialize auth middleware
	authMiddleware, err := middleware.NewAuthMiddleware(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize auth middleware: %w", err)
	}

	// Initialize CORS handler
	corsHandler := cors.NewHandler()

	return &Handler{
		storage:        storageClient,
		authMiddleware: authMiddleware,
		corsHandler:    corsHandler,
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
		errors.WriteError(w, r, errors.ErrMethodNotAllowed, h.corsHandler)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/")
	log.Printf("API request: %s %s", r.Method, path)

	// Route requests
	switch {
	case path == "health":
		// Health endpoint is public (no auth required)
		h.handleHealth(w, r)
	case strings.HasPrefix(path, "activities/"):
		// Activities endpoints require authentication
		h.authMiddleware.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h.handleActivities(w, r, path)
		})).ServeHTTP(w, r)
	default:
		errors.WriteError(w, r, errors.ErrNotFound, h.corsHandler)
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
		err := errors.NewAPIError(http.StatusBadRequest, "Invalid path format. Expected: /activities/{year}/{type}")
		errors.WriteError(w, r, err, h.corsHandler)
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
		err := errors.NewAPIError(http.StatusBadRequest, fmt.Sprintf("Invalid data type: %s", dataType))
		errors.WriteError(w, r, err, h.corsHandler)
		return
	}

	// Fetch data from storage
	data, err := h.storage.ReadJSON(r.Context(), blobPath)
	if err != nil {
		if err == storage.ErrNotFound {
			apiErr := errors.NewAPIError(http.StatusNotFound, fmt.Sprintf("Data not found for %s/%s", year, dataType))
			errors.WriteError(w, r, apiErr, h.corsHandler)
			return
		}
		apiErr := errors.NewAPIErrorWithLog(
			http.StatusInternalServerError,
			"Internal server error",
			fmt.Sprintf("Error reading blob %s: %v", blobPath, err),
		)
		errors.WriteError(w, r, apiErr, h.corsHandler)
		return
	}

	// Respond with data (already parsed JSON)
	h.respondJSONRaw(w, r, http.StatusOK, data)
}

// handleCORS responds to CORS preflight requests.
func (h *Handler) handleCORS(w http.ResponseWriter, r *http.Request) {
	h.corsHandler.HandlePreflight(w, r)
}

// respondJSON writes a JSON response with CORS headers.
func (h *Handler) respondJSON(w http.ResponseWriter, r *http.Request, status int, data interface{}) {
	h.corsHandler.SetHeaders(w, r)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON response: %v", err)
	}
}

// respondJSONRaw writes pre-marshaled JSON data with CORS headers.
func (h *Handler) respondJSONRaw(w http.ResponseWriter, r *http.Request, status int, data interface{}) {
	h.corsHandler.SetHeaders(w, r)

	w.Header().Set("Content-Type", "application/json")
	// Don't cache authenticated data - user-specific content
	w.Header().Set("Cache-Control", "private, no-store, must-revalidate")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON response: %v", err)
	}
}

