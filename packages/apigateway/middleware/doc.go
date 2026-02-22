// Package middleware provides HTTP middleware for the API Gateway.
//
// # Firebase Authentication
//
// The primary middleware is [AuthMiddleware], which validates Firebase ID tokens
// and checks email authorization against an allowlist.
//
// Create the middleware with [NewAuthMiddleware]:
//
//	allowedEmails := []string{"user@example.com", "admin@example.com"}
//	auth := middleware.NewAuthMiddleware(authClient, allowedEmails, logger)
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
// After the Strava OAuth cutover, this UID will be the Strava athlete ID (as a
// string), matching the PostgreSQL user_id column. Before the cutover, it is the
// Google-generated Firebase UID.
//
// # Authentication Flow
//
// The middleware performs these checks in order:
//
//  1. Extract Bearer token from Authorization header
//  2. Verify token with Firebase Admin SDK
//  3. Inject UID into request context
//  4. Extract email claim from verified token
//  5. Check email against configured allowlist
//
// # Failure Reason Codes
//
// Authentication failures are logged with reason codes for monitoring:
//
//   - missing_header: No Authorization header present
//   - invalid_header_format: Header not in "Bearer <token>" format
//   - token_verification_failed: Firebase rejected the token
//   - missing_email_claim: Token valid but no email claim
//   - email_not_authorized: Email not in ALLOWED_EMAILS
//
// These codes enable log aggregation and alerting on authentication issues.
//
// # Testing
//
// The [TokenVerifier] interface allows mocking Firebase for tests:
//
//	type mockVerifier struct{}
//	func (m *mockVerifier) VerifyIDToken(ctx context.Context, token string) (*auth.Token, error) {
//	    return &auth.Token{Claims: map[string]interface{}{"email": "test@example.com"}}, nil
//	}
package middleware
