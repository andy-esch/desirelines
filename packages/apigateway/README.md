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

```
packages/apigateway/
├── cmd/apigateway/      # Entry point
│   └── main.go
├── adapters/            # Infrastructure layer (hexagonal architecture)
│   └── postgres/        # PostgreSQL implementation
│       ├── activities.go
│       └── pool.go
├── repository/          # Domain interfaces and types
│   ├── activities.go    # ActivityRepository interface
│   └── types.go         # Domain types (Activity, SportMetrics, etc.)
├── middleware/          # HTTP middleware
│   └── auth.go          # Firebase token validation with email allowlist
├── config/              # Configuration
│   ├── sport_config.go  # Sport category mappings
│   └── sport_types.json # Embedded sport configuration
├── apierrors/           # API error handling
│   └── errors.go        # Structured error types and responses
├── cors/                # CORS handling
│   └── cors.go          # Origin validation and header management
├── logger/              # Structured logging
│   └── logger.go        # slog-based logger
├── types/               # API response types
│   ├── responses.go     # HealthResponse, ErrorResponse
│   └── generated/       # Generated protobuf types
├── handler.go           # HTTP handlers (routes registered here)
├── handler_test.go      # Handler tests
├── openapi.yaml         # OpenAPI specification
└── README.md
```

### Key Files

**`handler.go`** - Main entry point for routes. All HTTP handlers are defined here.
- `registerRoutes()` - Where routes are registered
- Handler methods follow pattern: `handle<Resource>` (e.g., `handleListActivities`)

**`repository/activities.go`** - Interface defining all data operations.
- Add new query methods here first
- Implementations go in `adapters/postgres/`

**`repository/types.go`** - Domain types for data operations.
- Domain entities and repository response types
- Types that represent data layer contracts

**`types/responses.go`** - API response types.
- HTTP response structures (HealthResponse, ErrorResponse)
- Keep types focused on API contract

### Adding a New Endpoint

1. Add types to `repository/types.go` (if needed)
2. Add interface method to `repository/activities.go`
3. Implement in `adapters/postgres/activities.go`
4. Add route in `handler.go` → `registerRoutes()`
5. Add handler method in `handler.go`
6. Add tests in `handler_test.go`
7. Update this README

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

- **Unit tests**: Mock the repository interface (`mockActivityRepository` in `handler_test.go`)
- **Integration tests**: Would test against real database (not yet implemented)

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

## Related Documentation

- [Deployment Guide](../../docs/guides/deployment.md)
- [Docker Guide](../../docs/guides/docker.md)
