// Package middleware provides HTTP middleware for the API Gateway.
//
// # Firebase Authentication
//
// The primary middleware is [AuthMiddleware], which validates Firebase ID tokens
// and checks email authorization against an allowlist.
//
// Create the middleware with [NewFirebaseAuth]:
//
//	allowedEmails := []string{"user@example.com", "admin@example.com"}
//	auth, err := middleware.NewFirebaseAuth(ctx, allowedEmails, logger)
//	if err != nil {
//	    log.Fatal(err)
//	}
//
// Apply it to protected routes:
//
//	r.Route("/api", func(r chi.Router) {
//	    r.Use(auth.Middleware)
//	    r.Get("/activities", handleActivities)
//	})
//
// # Authentication Flow
//
// The middleware performs these checks in order:
//
//  1. Extract Bearer token from Authorization header
//  2. Verify token with Firebase Admin SDK
//  3. Extract email claim from verified token
//  4. Check email against configured allowlist
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
// # Environment Variables
//
// Required:
//   - GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT: Firebase project ID
//
// Optional:
//   - FIREBASE_AUTH_EMULATOR_HOST: Use Firebase emulator for local development
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
