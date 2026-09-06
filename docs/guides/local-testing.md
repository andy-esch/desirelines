# Local Testing Guide

How to test the Desirelines pipeline locally using docker-compose and emulators.

## Quick Start

```bash
# Start full backend pipeline
just start-backend

# In another terminal, start frontend stack
just start-frontend

# Send a test webhook
curl -X POST http://localhost:8081/webhook \
  -H "Content-Type: application/json" \
  -d '{"aspect_type":"create","event_time":1234567890,"object_id":12345,"object_type":"activity","owner_id":67890,"subscription_id":123456}'
```

## Testing Modes

### 1. Backend Pipeline Testing

Tests the full event processing pipeline: Dispatcher → PubSub → stravapipe services.

```bash
just start-backend
```

**Services started:**

| Service | Port | Description |
|---------|------|-------------|
| Dispatcher | 8081 | Webhook receiver |
| PostgreSQL Writer | 8086 | PostgreSQL sync |
| PubSub Emulator | 8085 | Google PubSub emulator |
| CloudEvent Adapter | 8087 | Converts PubSub → CloudEvents |

**Test webhook delivery:**

```bash
# Create event
curl -X POST http://localhost:8081/webhook \
  -H "Content-Type: application/json" \
  -d '{"aspect_type":"create","object_id":12345,"object_type":"activity","owner_id":67890,"subscription_id":123456,"event_time":1704067200}'

# Watch logs
docker compose logs -f dispatcher postgres-writer
```

### 2. Frontend + API Testing

Tests the web UI with API Gateway and PostgreSQL.

```bash
just start-frontend
```

**Services started:**

| Service | Port | Description |
|---------|------|-------------|
| API Gateway | 8084 | REST API |
| PostgreSQL | 15430 | Local database |
| Firebase Emulators | 9099, 8089 | Auth + Firestore |
| Firebase UI | 4000 | Emulator dashboard |

**Test API:**

```bash
# Health check
curl http://localhost:8084/api/health

# Sport config (public)
curl http://localhost:8084/api/sports/config
```

See [frontend-local-dev.md](./frontend-local-dev.md) for authenticated testing.

### 3. Full Stack Testing

Run both profiles together:

```bash
# Terminal 1
just start-backend

# Terminal 2
just start-frontend

# Terminal 3
cd packages/web && npm run dev
```

This gives you the complete flow: webhook → processing → API → UI.

## Testing Scenarios

### Webhook Processing

```bash
# Test create event
curl -X POST http://localhost:8081/webhook \
  -H "Content-Type: application/json" \
  -d '{"aspect_type":"create","object_id":123,"object_type":"activity","owner_id":456,"subscription_id":123456,"event_time":1704067200}'

# Test delete event
curl -X POST http://localhost:8081/webhook \
  -H "Content-Type: application/json" \
  -d '{"aspect_type":"delete","object_id":123,"object_type":"activity","owner_id":456,"subscription_id":123456,"event_time":1704067200}'

# Test webhook verification (GET)
curl "http://localhost:8081/webhook?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=your_verify_token"
```

### Database Queries

```bash
# Connect to local PostgreSQL
docker compose exec postgres psql -U postgres -d desirelines

# Or use connection string
psql "postgresql://postgres:postgres@localhost:15430/desirelines"
```

```sql
-- Check activities (tables are schema-qualified; the sport column is `sport`,
-- and `start_date_local` is athlete local time)
SELECT id, name, sport, start_date_local
FROM desirelines.activities
ORDER BY start_date_local DESC
LIMIT 10;

-- Yearly totals by sport
SELECT year, sport, count(*) AS activities, round(sum(distance) / 1000) AS km
FROM desirelines.activities
GROUP BY year, sport
ORDER BY year DESC, km DESC;
```

### PubSub Messages

```bash
# View the PubSub emulator UI. `just start-backend` takes no arguments and
# hardcodes --profile backend, so add the debug profile with compose directly:
docker compose --env-file .env.local --profile backend --profile debug up --build --detach
# Open http://localhost:4200
```

## Running Tests

### Unit Tests

```bash
just test                    # All tests
just py-test                 # Python only
just go-test                 # Go only
just web-test                # Frontend only
```

### Integration Tests

```bash
# Python integration tests (require services running)
cd packages/stravapipe
uv run pytest tests/integration/ -v

# Go integration tests
cd packages/apigateway
go test -tags=integration ./...
```

## Troubleshooting

### Services Won't Start

```bash
# Check what's using ports
lsof -i :8081,:8084,:8085

# Clean restart
docker compose down -v
just start-backend
```

### PubSub Messages Not Processing

```bash
# Check emulator is running
curl http://localhost:8085

# Check subscription exists
docker compose logs pubsub-bootstrap

# Verify CloudEvent adapter is forwarding
docker compose logs cloudevent-adapter
```

### Database Connection Issues

```bash
# Check PostgreSQL is healthy
docker compose exec postgres pg_isready

# Reset database
docker compose down -v
just start-frontend
```

### Strava API Issues (Real Data Testing)

For testing with real Strava data, you need:

1. Strava API credentials configured
2. OAuth2 authorization completed

See [strava-webhook.md](./strava-webhook.md) for credential setup.

For production data backfills (activities, routes, region tags), use the
`desirelines-backfill` Cloud Run Job
(`packages/stravapipe/src/stravapipe/cloudrun/backfill_job.py`):
`gcloud run jobs execute desirelines-backfill --set-env-vars ATHLETE_ID=<id>,BACKFILL_YEARS=2024`.
To load the region boundary reference table, see
[scripts/ops/regions/README.md](../../scripts/ops/regions/README.md).

## Environment Variables

Local testing reads **`.env.local`** in the repo root, not `.env` — `Justfile:2`
sets `set dotenv-filename := ".env.local"` and the compose recipes pass
`--env-file .env.local`. A plain `.env` is silently ignored. Start from the
template:

```bash
cp .env.local.example .env.local
```

`.env.local` carries your Strava OAuth credentials, GCP project and email
allowlist, plus the local Postgres trio `docker-compose.yml` interpolates (it
has no defaults for these, so compose fails without them):

```bash
POSTGRES_USER_LOCAL=postgres
POSTGRES_PASSWORD_LOCAL=postgres
POSTGRES_DB_LOCAL=desirelines
```

The emulator wiring is not yours to set. `docker-compose.yml` hardcodes it per
service using *container* hostnames — inside the compose network there is no
`localhost` to point at:

| Variable | Value in compose |
|----------|------------------|
| `PUBSUB_EMULATOR_HOST` | `pubsub-emulator:8085` |
| `GCP_PUBSUB_TOPIC` | `desirelines_activity_events` |
| `POSTGRES_CONNECTION_STRING` | `postgresql://…@postgres:5432/…` |
| `FIREBASE_AUTH_EMULATOR_HOST` | `firebase-emulators:9099` |

From the host, reach the same services through the published ports instead
(Postgres on `localhost:15430`, the PubSub UI on `localhost:4200`).

## Related

- [Frontend Development](./frontend-local-dev.md) - React UI development
- [Docker Guide](./docker.md) - Container builds
- [Region Data Loader](../../scripts/ops/regions/README.md) - Census boundary reference data
