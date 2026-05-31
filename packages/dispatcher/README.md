# Dispatcher (Go)

Receives Strava webhook events, enriches CREATE events with activity data from the Strava API, and publishes enriched events to PubSub for downstream processing. It also handles Strava athlete **deauthorization**: deleting the athlete's stored OAuth tokens from Firestore and publishing to a dedicated deauth topic (see [Deauthorization](#deauthorization)).

## Architecture

```
Strava Webhook → Dispatcher (Cloud Run) → [enrich with Strava API] → PubSub Topic → Eventarc → downstream services
                                         ↘ [athlete deauth] → delete Firestore tokens + PubSub Deauth Topic → downstream services
```

The dispatcher is the **only service** that calls the Strava API. Downstream consumers (bq-inserter, postgres-writer) receive enriched events with activity data inline and do not need Strava API credentials.

**Package Structure (Hexagonal Architecture):**

```
packages/dispatcher/
├── cmd/dispatcher/main.go         # HTTP server entrypoint (composition root)
├── adapters/
│   ├── http/handler.go            # HTTP handler (inbound adapter)
│   ├── pubsub/publisher.go        # PubSub publishing (outbound adapter)
│   ├── strava/client.go           # Strava API client (outbound adapter)
│   ├── firestore/token_store.go   # Per-athlete OAuth token store (Firestore)
│   ├── proto/webhook_adapter.go   # JSON ↔ protobuf conversion
│   └── env/secrets.go             # Environment/secrets adapter
├── ports/
│   ├── interfaces.go              # Port interfaces (Publisher, SecretProvider, StravaClient, TokenStore)
│   └── portstest/mocks.go         # Shared test mocks
├── types/generated/webhook.pb.go  # Generated protobuf types
├── config/config.go               # Configuration loading
└── Dockerfile                     # Cloud Run container
```

The athlete-allowlist check (`packages/shared/allowlist`) is shared with the
apigateway. On the **activity** path the dispatcher uses it to drop stray
webhooks — events from athletes who hold a Strava OAuth grant but are not
allowlisted in this environment — before any Strava API call. The **deauth**
path deliberately skips this check (see [Deauthorization](#deauthorization)).
See `webhook/owner_check` metric for outcome breakdown.

**Type Definitions:** Webhook types are defined in `schemas/proto/desirelines/webhook/v1/webhook.proto` and shared with stravapipe (Python). Generated code lives in `types/generated/`. See `just proto-gen-backend`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/webhook` | Strava subscription verification (hub.mode, hub.challenge, hub.verify_token) |
| `POST` | `/webhook` | Receive Strava webhook events |
| `GET` | `/health` | Health check endpoint |
| `HEAD` | `/` | Health probe for Cloud Run |

**Note:** The Strava webhook callback URL must include the `/webhook` path (e.g., `https://your-service.run.app/webhook`).

## Deauthorization

Strava signals athlete deauthorization with an `athlete` webhook event — either
`aspect_type=delete` or an `update` whose payload carries
`updates={"authorized":"false"}` (handled in `adapters/http/handler.go`,
`handleAthleteEvent`). On deauth the dispatcher:

1. **Best-effort deletes** the athlete's stored OAuth tokens from Firestore
   (database `FIRESTORE_DATABASE`); a failure is logged and left to the
   downstream deletion job.
2. **Publishes** the event to the dedicated deauth topic
   (`GCP_PUBSUB_DEAUTH_TOPIC`) so downstream consumers can act on it.

Unlike the activity path, deauth **deliberately does not gate on the
allowlist**. Deauth is cleanup, and cleanup must run regardless of *current*
allowlist membership: an athlete who was allowlisted, is later removed, and then
deauthorizes still has tokens and downstream data to purge — gating on
`IsAllowed` would strand it. A true stray (never allowlisted) has no tokens or
data, so the delete and publish are harmless, idempotent no-ops.

`FIRESTORE_DATABASE` and `GCP_PUBSUB_DEAUTH_TOPIC` are fail-fast-required at
startup precisely because of this flow.

## Environment Variables

All four variables below are validated up front in `config.LoadConfig` — the
service refuses to start (fail-fast) if any is missing.

```bash
# Required (fail-fast)
GCP_PROJECT_ID=desirelines-dev
GCP_PUBSUB_TOPIC=desirelines_activity_events
GCP_PUBSUB_DEAUTH_TOPIC=desirelines_deauth_events
FIRESTORE_DATABASE=desirelines

# Optional
LOG_LEVEL=INFO   # Default: INFO
PORT=8080        # Default: 8080 (Cloud Run sets this)
```

### Secrets

The webhook and Strava API secrets are loaded from secret file mounts
(preferred) with environment variable fallback. `STRAVA_WEBHOOK_SUBSCRIPTION_ID`
and the verify token are loaded this way too (by the `env` secret cache) — they
are **not** plain config vars:

| Secret Mount | Env Var Fallback | Description |
|-------------|------------------|-------------|
| `/etc/secrets/INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN/value` | `STRAVA_WEBHOOK_VERIFY_TOKEN` | Webhook subscription verify token |
| `/etc/secrets/INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID/value` | `STRAVA_WEBHOOK_SUBSCRIPTION_ID` | Strava webhook subscription ID |
| `/etc/secrets/INFISICAL_STRAVA_CLIENT_ID/value` | `STRAVA_CLIENT_ID` | Strava API app client ID |
| `/etc/secrets/INFISICAL_STRAVA_CLIENT_SECRET/value` | `STRAVA_CLIENT_SECRET` | Strava API app client secret |

## Development

### Local with docker-compose

```bash
# Start backend (includes PubSub emulator)
docker compose --profile backend up

# Test webhook
curl -X POST http://localhost:8081/webhook \
  -H "Content-Type: application/json" \
  -d '{"aspect_type":"create","event_time":1234567890,"object_id":12345,"object_type":"activity","owner_id":67890,"subscription_id":123456}'
```

### Standalone

```bash
cd packages/dispatcher

# Start PubSub emulator
docker compose up pubsub-emulator pubsub-bootstrap -d

# Run dispatcher
PUBSUB_EMULATOR_HOST=localhost:8085 \
GCP_PROJECT_ID=local-dev \
GCP_PUBSUB_TOPIC=desirelines_activity_events \
GCP_PUBSUB_DEAUTH_TOPIC=desirelines_deauth_events \
FIRESTORE_DATABASE=local-dev \
STRAVA_WEBHOOK_SUBSCRIPTION_ID=123456 \
go run ./cmd/dispatcher
```

### Tests

```bash
go test ./...
```

### Benchmarks

```bash
# All dispatcher benchmarks (no unit tests; run from packages/dispatcher/):
go test ./... -run '^$' -bench . -benchmem

# A single package, e.g. the secret cache:
go test ./adapters/env/ -run '^$' -bench BenchmarkSecretCache -benchmem
```

## Performance

Baseline numbers (Apple M5, go1.26.3, `-benchmem`). Treat these as
order-of-magnitude reference for regression-spotting, not hard SLOs — absolute
ns/op vary by machine. Re-run with the commands above.

| Benchmark | ns/op | B/op | allocs/op | Notes |
| --- | --- | --- | --- | --- |
| `SecretCache_GetSecrets_CacheHit` | ~21 | 0 | 0 | Hot path (RLock + TTL check); runs every request |
| `SecretCache_GetSecrets_Concurrent` | ~99 | 0 | 0 | Cache hit under parallel readers (lock contention) |
| `SecretCache_GetSecrets_CacheMiss` | ~17,000 | ~66k | 12 | TTL-expiry re-check: re-reads + SHA256-hashes both secret files (once per TTL interval) |
| `Webhook_Validate` | ~1.3 | 0 | 0 | Pure proto validation, every POST |
| `Webhook_Parse` | ~770 | ~408 | 8 | JSON → protobuf decode |
| `Handler_ServeHTTP_ValidWebhook` | ~4,200 | ~12k | 96 | Full request lifecycle (mocked publisher/Strava) |
| `Handler_ServeHTTP_Verification` | ~3,200 | ~10k | 66 | GET subscription-verification handshake |
| `Handler_ServeHTTP_Concurrent` | ~2,000 | ~12k | 96 | Valid webhook under parallel load |

The cache hot path is effectively free (~21 ns, 0 allocs), so the secret cache
is not a request-path bottleneck; the per-TTL re-check (~17 µs) is amortized
across an entire TTL window. Handler cost is dominated by request setup, not
secret access. The optimization ideas below the line in
`adapters/http/benchmark_test.go`'s sibling notes are only worth pursuing if a
profile shows a specific hot spot — current numbers don't warrant it.

## Deployment

```bash
# Build and publish all images
just build-publish

# Deploy by merging to main (triggers CI → deploy repo)
# Or manually from desirelines-deploy repo
```

See [Docker Guide](../../docs/guides/docker.md) and [Deployment Guide](../../docs/guides/deployment.md).

## Package Documentation

Each package has GoDoc documentation viewable via `go doc`:

| Package | Description |
|---------|-------------|
| [ports](./ports/) | Port interfaces (Publisher, SecretProvider, StravaClient) |
| [adapters/http](./adapters/http/) | HTTP webhook handler |
| [adapters/pubsub](./adapters/pubsub/) | Google Cloud Pub/Sub adapter |
| [adapters/strava](./adapters/strava/) | Strava API client (token management, activity fetch) |
| [adapters/env](./adapters/env/) | Secrets loading with caching |
| [adapters/proto](./adapters/proto/) | JSON ↔ protobuf conversion |
| [config](./config/) | Configuration loading |

Logging uses the shared [gcplog](../shared/gcplog/) package.
