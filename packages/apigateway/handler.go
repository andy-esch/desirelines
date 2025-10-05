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

	"github.com/andy-esch/desirelines/packages/apigateway/storage"
	"github.com/andy-esch/desirelines/packages/apigateway/types"
)

// Handler orchestrates API Gateway request processing.
type Handler struct {
	storage storage.Client
}

// NewHandler creates a new API Gateway handler.
func NewHandler(ctx context.Context) (*Handler, error) {
	storageClient, err := storage.NewCloudStorageClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create storage client: %w", err)
	}

	return &Handler{
		storage: storageClient,
	}, nil
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
		h.respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
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
		h.respondError(w, http.StatusNotFound, "Not found")
	}
}

// handleHealth returns API health status.
func (h *Handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	response := types.HealthResponse{
		Status: "healthy",
	}
	h.respondJSON(w, http.StatusOK, response)
}

// handleActivities routes activity data requests.
func (h *Handler) handleActivities(w http.ResponseWriter, r *http.Request, path string) {
	// Parse path: activities/{year}/{data_type}
	parts := strings.Split(path, "/")
	if len(parts) != 3 {
		h.respondError(w, http.StatusBadRequest, "Invalid path format. Expected: /activities/{year}/{type}")
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
	case "pacings":
		blobPath = fmt.Sprintf("activities/%s/pacings.json", year)
	default:
		h.respondError(w, http.StatusBadRequest, fmt.Sprintf("Invalid data type: %s", dataType))
		return
	}

	// Fetch data from storage
	data, err := h.storage.ReadJSON(r.Context(), blobPath)
	if err != nil {
		if err == storage.ErrNotFound {
			h.respondError(w, http.StatusNotFound, fmt.Sprintf("Data not found for %s/%s", year, dataType))
			return
		}
		log.Printf("Error reading blob %s: %v", blobPath, err)
		h.respondError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	// Respond with data (already parsed JSON)
	h.respondJSONRaw(w, http.StatusOK, data)
}

// handleCORS responds to CORS preflight requests.
func (h *Handler) handleCORS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Max-Age", "3600")
	w.WriteHeader(http.StatusNoContent)
}

// respondJSON writes a JSON response with CORS headers.
func (h *Handler) respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON response: %v", err)
	}
}

// respondJSONRaw writes pre-marshaled JSON data with CORS headers.
func (h *Handler) respondJSONRaw(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300") // 5 minutes
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON response: %v", err)
	}
}

// respondError writes an error response with CORS headers.
func (h *Handler) respondError(w http.ResponseWriter, status int, message string) {
	response := types.ErrorResponse{
		Error: message,
	}
	h.respondJSON(w, status, response)
}
