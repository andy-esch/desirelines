# API Gateway (Go)

REST API serving activity data from PostgreSQL to the web frontend.

## Quick Start

```bash
# Run tests
go test ./...

# Run locally (requires POSTGRES_CONNECTION_STRING with application_name parameter)
# Example: postgresql://user:pass@localhost:5432/dbname?application_name=apigateway
export POSTGRES_CONNECTION_STRING="postgresql://..."
export ALLOWED_EMAILS="your-email@example.com"
export ALLOWED_ORIGINS="http://localhost:3000"
export GCP_PROJECT_ID="your-project-id"  # or GOOGLE_CLOUD_PROJECT
go run ./cmd/apigateway

# Build
go build ./cmd/apigateway
```

## API Endpoints

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (includes database status) |
| GET | `/sports/config` | Sport configuration (cycling, running, yoga mappings) |

### Authenticated Endpoints

All authenticated endpoints require `Authorization: Bearer <firebase-token>` header.

#### Aggregated Data (by year)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/activities/{year}/metadata` | Year totals for all sports |
| GET | `/activities/{year}/metrics?sport=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]` | Cumulative timeseries for one sport (optional date range can span years) |
| GET | `/activities/{year}/source?sport=X` | Daily summaries for one sport |

#### Individual Activities

| Method | Path | Description |
|--------|------|-------------|
| GET | `/activities` | List activities (paginated) |
| GET | `/activities/{id}` | Get single activity by Strava ID |

### Query Parameters

**`/activities` (list)**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | date | - | Start date (YYYY-MM-DD), inclusive |
| `to` | date | - | End date (YYYY-MM-DD), inclusive |
| `sport` | string | - | Filter by sport category |
| `limit` | int | 20 | Results per page (1-100) |
| `cursor` | string | - | Pagination cursor (from `next_cursor`) |

**Valid sport values**: `cycling`, `running`, `yoga`

### Pagination

The `/activities` endpoint uses cursor-based pagination:

```json
{
  "activities": [...],
  "next_cursor": "MjAyNS0xMi0yOFQwODozMDowMFp8MTIzNDU2Nzg5MDE=",
  "has_more": true
}
```

To fetch the next page, pass `cursor=<next_cursor>` as a query parameter.

### Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success (empty data returns `[]`, not 404) |
| 400 | Invalid request (bad year, sport, date format) |
| 401 | Missing or invalid auth token |
| 403 | User not authorized |
| 404 | Activity not found (for `/activities/{id}` only) |
| 500 | Server error |
| 503 | Database unavailable |

## Architecture

This package follows **hexagonal architecture** (ports and adapters pattern):

```
packages/apigateway/
├── cmd/apigateway/
│   └── main.go              # Composition root - wires all dependencies
├── internal/                # Application layer (not importable externally)
│   ├── activities/
│   │   └── handler.go       # Activity endpoints (/activities/*)
│   ├── health/
│   │   └── handler.go       # Health check endpoint
│   ├── sports/
│   │   └── handler.go       # Sport config endpoint
│   └── server/
│       ├── router.go        # Route registration with chi
│       ├── middleware.go    # CORS middleware
│       └── response.go      # JSON response helpers
├── pkg/                     # Shared utilities (importable)
│   └── validate/
│       └── validate.go      # Date, year validation helpers
├── repository/              # Domain interfaces (ports)
│   ├── activities.go        # ActivityRepository interface
│   └── types.go             # Domain types (Activity, SportMetrics, etc.)
├── adapters/                # Infrastructure implementations (adapters)
│   └── postgres/
│       ├── activities.go    # PostgreSQL repository implementation
│       └── pool.go          # Connection pool management
├── middleware/
│   └── auth.go              # Firebase JWT + email allowlist
├── config/
│   ├── sport_config.go      # Sport category mappings
│   └── sport_types.json     # Embedded sport configuration
├── apierrors/
│   └── errors.go            # Structured error types
├── cors/
│   └── cors.go              # Origin validation
├── logger/
│   └── logger.go            # slog-based structured logging
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

### Adding a New Endpoint

1. **Define types** in `repository/types.go` (if needed)
2. **Add interface method** to `repository/activities.go`
3. **Implement query** in `adapters/postgres/activities.go`
4. **Create/update handler** in appropriate `internal/*/handler.go`
5. **Register route** in `internal/server/router.go`
6. **Wire in main.go** if new handler package
7. **Add tests** in `handler_test.go`
8. **Update this README**

## Environment Variables

```bash
# Server
PORT=8080                          # HTTP port (default: 8080)

# Database (required)
# Local development:
POSTGRES_CONNECTION_STRING=postgresql://user:pass@host:port/db?application_name=apigateway
# Cloud Run (uses secret mount):
# /etc/secrets/postgres/connection_string
# Note: Connection string MUST include application_name parameter for observability

# Authentication (Firebase)
GCP_PROJECT_ID=your-project-id     # Google Cloud project ID (or GOOGLE_CLOUD_PROJECT)
ALLOWED_EMAILS=user@example.com    # Comma-separated authorized emails
# For local development with Firebase emulator:
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099

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

Build and publish via Pants:

```bash
# Build all services
make build-publish

# Build only apigateway
GIT_COMMIT=$(git rev-parse --short HEAD) pants publish packages/apigateway:apigateway
```

### Deploy to Cloud Run

```bash
# Deploy via Terraform
cd terraform/environments/dev
terraform apply -var="deployment_version=$(git rev-parse --short HEAD)"
```

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

Run `make proto-gen-backend` to regenerate. See [`schemas/proto/README.md`](../../schemas/proto/README.md).

## Related Documentation

- [Deployment Guide](../../docs/guides/deployment.md)
- [Docker Guide](../../docs/guides/docker.md)
