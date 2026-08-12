# API Gateway (Go)

REST API serving activity data from PostgreSQL to the web frontend.

## Quick Start

```bash
# Run tests
go test ./...

# Run locally (requires POSTGRES_CONNECTION_STRING with application_name parameter)
# Example: postgresql://user:pass@localhost:5432/dbname?application_name=apigateway
export POSTGRES_CONNECTION_STRING="postgresql://..."
export ALLOWED_ORIGINS="http://localhost:3000"
export GCP_PROJECT_ID="your-project-id"  # or GOOGLE_CLOUD_PROJECT
go run ./cmd/apigateway

# Build
go build ./cmd/apigateway
```

## API Endpoints

See [`openapi.yaml`](./openapi.yaml) for the full API specification — endpoints, query parameters, request/response schemas, and status codes. This is the canonical contract, validated in CI.

## Architecture

This package follows **hexagonal architecture** (ports and adapters pattern):

```
packages/apigateway/
├── cmd/apigateway/
│   └── main.go              # Composition root - wires all dependencies
├── internal/                # Application layer (not importable externally)
│   ├── activities/
│   │   └── handler.go       # Activity endpoints (/activities/*)
│   ├── auth/
│   │   ├── handler.go       # Strava OAuth endpoints (/auth/strava[/start], /auth/callback)
│   │   ├── state.go         # CSRF state token (JWT) generation/validation
│   │   ├── interfaces.go    # Port interfaces (StravaOAuthClient, TokenStore, etc.)
│   │   └── types.go         # OAuth data types (token response, athlete profile)
│   ├── health/
│   │   └── handler.go       # Health check endpoint
│   ├── sports/
│   │   └── handler.go       # Sport config endpoint
│   └── server/
│       ├── router.go        # Route registration with chi
│       ├── middleware.go     # CORS middleware
│       └── response.go      # JSON response helpers
├── pkg/                     # Shared utilities (importable)
│   ├── validate/            # Date, year, input validation
│   └── cors/                # CORS origin handling
├── repository/              # Domain interfaces (ports)
│   ├── activities.go        # ActivityRepository interface
│   └── types.go             # Domain types (Activity, SportMetrics, etc.)
├── adapters/                # Infrastructure implementations (adapters)
│   ├── postgres/
│   │   ├── activities.go    # PostgreSQL repository implementation
│   │   └── pool.go          # Connection pool management
│   ├── strava/
│   │   └── oauth.go         # Strava OAuth token exchange client
│   └── firestore/
│       └── auth_store.go    # Firestore allowlist + token/profile storage
├── middleware/
│   └── auth.go              # Firebase JWT verification
├── config/
│   ├── sport_config.go      # Sport category mappings
│   └── sport_types.json     # Embedded sport configuration
├── handler_test.go          # Integration tests
└── README.md
```

### Hexagonal Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │           main.go                   │
                    │      (Composition Root)             │
                    │  Creates and wires all dependencies │
                    └─────────────────┬───────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │                            │                            │
         ▼                            ▼                            ▼
┌─────────────────┐      ┌─────────────────────┐      ┌─────────────────┐
│ internal/health │      │ internal/activities │      │ internal/sports │
│    Handler      │      │      Handler        │      │    Handler      │
└────────┬────────┘      └──────────┬──────────┘      └─────────────────┘
         │                          │
         │                          ▼
         │               ┌─────────────────────┐
         │               │ repository.Activity │  ◄── Port (interface)
         │               │     Repository      │
         │               └──────────┬──────────┘
         │                          │
         │                          ▼
         │               ┌─────────────────────┐
         └──────────────►│ adapters/postgres   │  ◄── Adapter (implementation)
                         │ ActivityRepository  │
                         └─────────────────────┘
```

### Key Directories

**`cmd/apigateway/main.go`** - Composition root

- Creates all dependencies (config, auth, database pool)
- Wires handlers with their dependencies
- Builds and starts the HTTP server
- Single place where all wiring happens

**`internal/`** - Feature-based HTTP handlers

- Each feature (health, sports, activities) has its own package
- Handlers receive dependencies via constructor injection
- `server/` contains shared HTTP utilities (router, middleware, response helpers)

**`pkg/validate/`** - Shared validation

- Reusable validation functions (year, date, date range)
- Can be imported by any package

**`repository/`** - Domain interfaces (ports)

- `activities.go` - Interface defining all data operations
- `types.go` - Domain types (Activity, SportMetrics, etc.)
- Add new query methods here first

**`adapters/postgres/`** - PostgreSQL implementation (adapter)

- Implements `repository.ActivityRepository`
- All SQL queries live here

**`adapters/strava/`** - Strava API adapter

- `OAuthClient` implements `auth.StravaOAuthClient` for token exchange
- HTTP client with 10s timeout, response body limited to 64KB

**`adapters/firestore/`** - Firestore adapter

- `AuthStore` implements both `auth.AllowlistChecker` and `auth.TokenStore`
- Atomic writes via Firestore transactions (tokens + profile succeed or fail together)

### Adding a New Endpoint

1. **Define types** in `repository/types.go` (if needed)
2. **Add interface method** to `repository/activities.go`
3. **Implement query** in `adapters/postgres/activities.go`
4. **Create/update handler** in appropriate `internal/*/handler.go`
5. **Register route** in `internal/server/router.go`
6. **Wire in main.go** if new handler package
7. **Add tests** in `handler_test.go`
8. **Update `openapi.yaml`** with the new endpoint

## Environment Variables

```bash
# Server
PORT=8080                          # HTTP port (default: 8080)

# Database (required)
# Local development:
POSTGRES_CONNECTION_STRING=postgresql://user:pass@host:port/db?application_name=apigateway
# Cloud Run (uses secret mount):
# /etc/secrets/INFISICAL_POSTGRES_CONN_APIGATEWAY/value
# Note: Connection string MUST include application_name parameter for observability

# Database pool tuning (optional - sensible defaults for Cloud Run + Neon)
# DB_POOL_MAX_CONNS=5                # Maximum connections (default: 5)
# DB_POOL_MIN_CONNS=0                # Minimum connections to maintain (default: 0)
# DB_POOL_MAX_CONN_LIFETIME_MINUTES=30  # Connection refresh interval (default: 30)
# DB_POOL_MAX_CONN_IDLE_MINUTES=5    # Idle connection timeout (default: 5)
# DB_POOL_HEALTH_CHECK_MINUTES=1     # Health check interval (default: 1)
# DB_SLOW_QUERY_THRESHOLD_MS=500     # WARN log threshold for slow queries (default: 500, 0 disables)

# Authentication (Firebase)
GCP_PROJECT_ID=your-project-id     # Google Cloud project ID (or GOOGLE_CLOUD_PROJECT)
# For local development with Firebase emulator:
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099

# Strava OAuth (required for /auth/* endpoints)
# Cloud Run: loaded from Infisical secret mounts
# Local development: set as environment variables
STRAVA_CLIENT_ID=your-strava-client-id
STRAVA_CLIENT_SECRET=your-strava-client-secret
AUTH_STATE_SECRET=your-32-byte-secret       # HMAC key for CSRF state tokens
FRONTEND_URL=https://app.example.com        # Where to redirect after OAuth
AUTH_CALLBACK_URL=https://api.example.com/auth/callback  # Strava redirect_uri

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://app.example.com  # Comma-separated origins
```

## Testing

```bash
# All tests
go test ./...

# With coverage
go test ./... -cover
```

### Test Structure

- **Integration tests** (`handler_test.go`): Test full HTTP request/response flow with mocked repository
  - Uses `mockActivityRepository` to simulate database responses
  - Tests route registration, validation, error handling, CORS
- **Validation tests** (`handler_test.go`): Test `pkg/validate` functions directly
- **Database tests** (`adapters/postgres/*_test.go`): Test PostgreSQL queries

## OpenAPI Specification

See `openapi.yaml` for the API specification.

## Deployment

### Build and Publish

```bash
# Build and publish all images
just build-publish
```

### Deploy to Cloud Run

Deploy by merging to main (triggers CI → deploy repo), or manually from the `desirelines-deploy` repo.

### Health Check

Cloud Run uses `/health` endpoint:

```json
{
  "status": "healthy",
  "database": "healthy"
}
```

## Protobuf Types

API response types are generated from `schemas/proto/`:

```
types/generated/
├── sports_metrics.pb.go  # SportMetrics, CumulativeMetricsEntry
└── user_config.pb.go     # UserConfig, Goal, Annotation
```

Run `just proto-gen-backend` to regenerate. See [`schemas/proto/README.md`](../../schemas/proto/README.md).

## Package Documentation

Each package has GoDoc documentation viewable via `go doc`:

| Package | Description |
|---------|-------------|
| [internal/auth](./internal/auth/) | Strava OAuth2 flow (initiate, callback, state tokens) |
| [pkg/validate](./pkg/validate/) | Input validation (dates, years, sports, cursors) |
| [pkg/cors](./pkg/cors/) | CORS origin handling |
| [middleware](./middleware/) | Firebase JWT authentication |
| [config](./config/) | Sport category configuration |
| [repository](./repository/) | Domain interfaces (ActivityRepository) |
| [adapters/strava](./adapters/strava/) | Strava API OAuth client |
| [adapters/firestore](./adapters/firestore/) | Firestore allowlist and token storage |

Logging uses the shared [gcplog](../shared/gcplog/) package.

## Related Documentation

- [Frontend API Client](../web/src/api/README.md) - TypeScript client error handling patterns
- [Deployment Guide](../../docs/guides/deployment.md)
- [Docker Guide](../../docs/guides/docker.md)
