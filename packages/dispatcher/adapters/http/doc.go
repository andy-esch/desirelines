// Package httpadapter provides HTTP handlers for receiving Strava webhook notifications.
//
// This adapter implements the HTTP layer for the dispatcher service, handling
// both webhook verification (GET) and event reception (POST) endpoints.
//
// # Basic Usage
//
//	handler := httpadapter.NewHandler(publisher, deauthPublisher, secretProvider, stravaClient, tokenStore, logger, &httpadapter.HandlerConfig{
//	    MaxRequestBodySize: 1 << 20, // 1MB
//	})
//	router := handler.RegisterRoutes()
//
//	server := &http.Server{
//	    Addr:    ":8080",
//	    Handler: router,
//	}
//
// # Endpoints
//
// The handler registers these routes:
//
//	HEAD /         - Health check (for load balancers)
//	GET  /health   - Health check (returns 200 OK)
//	GET  /webhook  - Strava subscription verification
//	POST /webhook  - Receive webhook events
//
// # Webhook Verification (GET /webhook)
//
// Strava sends a verification request when setting up a subscription:
//
//	GET /webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE
//
// The handler validates the token against [ports.SecretProvider] and echoes
// back the challenge if valid.
//
// # Event Reception (POST /webhook)
//
// Strava sends webhook events as JSON:
//
//	POST /webhook
//	Content-Type: application/json
//	{"object_type":"activity","object_id":123,"aspect_type":"create",...}
//
// The handler validates, converts to protobuf, and publishes via [ports.Publisher].
//
// # Error Codes
//
// The handler returns structured error responses with codes:
//
//	ErrCodeConfigError           - Secret provider misconfiguration
//	ErrCodeInvalidHubMode        - hub.mode is not "subscribe"
//	ErrCodeInvalidVerifyToken    - Token doesn't match configured secret
//	ErrCodeInvalidContentType    - Content-Type is not application/json
//	ErrCodeReadFailed            - Failed to read request body
//	ErrCodeInvalidJSON           - Malformed JSON payload
//	ErrCodeValidationFailed      - Webhook validation failed
//	ErrCodeInvalidSubscriptionID - Subscription ID mismatch
//	ErrCodePublishFailed         - Failed to publish to message queue
//
// # Middleware
//
// [Handler.RegisterRoutes] automatically configures:
//   - Request ID generation
//   - Real IP extraction
//   - Structured request logging (via gcplog)
//   - Panic recovery
//
// # Graceful Shutdown
//
// Call Close to release handler resources:
//
//	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
//	defer cancel()
//	handler.Close(ctx)
package httpadapter
