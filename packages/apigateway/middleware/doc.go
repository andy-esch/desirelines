// Package middleware provides HTTP middleware for the API Gateway.
//
// # Firebase Authentication
//
// The primary middleware is [AuthMiddleware], which validates Firebase ID tokens
// and injects the authenticated user's ID into the request context.
//
// Production creates the middleware with [NewAuthMiddlewareWithAccessCheck] so
// removing an athlete from the Firestore allowlist takes effect no later than
// the configured short positive-cache TTL:
//
//	auth := middleware.NewAuthMiddlewareWithAccessCheck(authClient, allowlist, logger, histogram, tracer)
//
// Apply it to protected routes:
//
//	r.Route("/api", func(r chi.Router) {
//	    r.Use(auth.Middleware)
//	    r.Get("/activities", handleActivities)
//	})
//
// # User ID Context
//
// On successful authentication, the middleware injects the Firebase UID into the
// request context. Downstream handlers can retrieve it with [GetUserID]:
//
//	uid := middleware.GetUserID(r.Context())
//
// The UID is the Strava athlete ID (as a string), matching the PostgreSQL
// user_id column.
//
// # Authentication Flow
//
// The middleware performs these checks in order:
//
//  1. Extract Bearer token from Authorization header
//  2. Verify token with Firebase Admin SDK
//  3. Re-check the athlete allowlist (when configured)
//  4. Inject UID into request context
//
// # Failure Reason Codes
//
// Authentication failures are logged with reason codes for monitoring:
//
//   - missing_header: No Authorization header present
//   - invalid_header_format: Header not in "Bearer <token>" format
//   - token_too_large: Bearer token exceeded the accepted size bound
//   - token_verification_failed: Firebase rejected the token
//
// These codes enable log aggregation and alerting on authentication issues.
//
// # Testing
//
// The [TokenVerifier] interface allows mocking Firebase for tests:
//
//	type mockVerifier struct{}
//	func (m *mockVerifier) VerifyIDToken(ctx context.Context, token string) (*auth.Token, error) {
//	    return &auth.Token{UID: "12345"}, nil
//	}
package middleware
