// Package cors provides CORS (Cross-Origin Resource Sharing) handling for the API Gateway.
//
// # Overview
//
// This package implements origin allowlist-based CORS with O(1) origin lookup.
// It's designed for APIs that need to allow specific origins while rejecting others.
//
// # Basic Usage
//
// Create a handler with allowed origins:
//
//	allowedOrigins := []string{"https://example.com", "https://app.example.com"}
//	corsHandler, err := cors.NewHandler(allowedOrigins, logger, strict)
//	if err != nil {
//	    return fmt.Errorf("init CORS: %w", err)
//	}
//
// Use in your HTTP handlers:
//
//	func handleRequest(w http.ResponseWriter, r *http.Request) {
//	    if !corsHandler.SetHeaders(w, r) {
//	        http.Error(w, "origin not allowed", http.StatusForbidden)
//	        return
//	    }
//	    // ... handle request
//	}
//
// # Preflight Requests
//
// Handle OPTIONS requests for CORS preflight:
//
//	r.Options("/*", corsHandler.HandlePreflight)
//
// # Headers Set
//
// For allowed origins, [Handler.SetHeaders] sets:
//   - Access-Control-Allow-Origin: <origin>
//   - Access-Control-Allow-Credentials: true
//
// For preflight, [Handler.HandlePreflight] additionally sets:
//   - Access-Control-Allow-Methods: GET, OPTIONS
//   - Access-Control-Allow-Headers: Content-Type, Authorization
//   - Access-Control-Max-Age: 3600
//
// # Configuration
//
// Origins are typically configured via environment variable:
//
//	export ALLOWED_ORIGINS="https://example.com,https://app.example.com"
package cors
