# Dispatcher (Go)

Receives Strava webhook events, enriches activity events that need a payload with data from the Strava API, and publishes enriched events to PubSub for downstream processing. It also handles Strava athlete **deauthorization**: deleting the athlete's stored OAuth tokens from Firestore and publishing to a dedicated deauth topic (see [Deauthorization](#deauthorization)).

## Architecture

```
Strava Webhook → Dispatcher (Cloud Run) → [enrich with Strava API] → PubSub Topic → Eventarc → downstream services
                                         ↘ [best-effort, when enabled] → activity-row topic → BigQuery CDC subscription → activities_live
                                         ↘ [athlete deauth] → confirm grant → PubSub Deauth Topic + best-effort token deletion → downstream services
```

The dispatcher fetches activity payloads for webhooks. The postgres-writer receives those payloads inline and does not need Strava API credentials.

**Package Structure (Hexagonal Architecture):**

```
packages/dispatcher/
├── cmd/dispatcher/main.go         # HTTP server entrypoint (composition root)
├── adapters/
│   ├── http/handler.go            # HTTP handler (inbound adapter)
│   ├── pubsub/publisher.go        # PubSub publishing (outbound adapter)
│   ├── strava/client.go           # Strava API client (outbound adapter)
│   ├── firestore/token_store.go   # UID-keyed OAuth token store (Firestore)
│   ├── proto/webhook_adapter.go   # JSON ↔ protobuf conversion
│   └── env/secrets.go             # Environment/secrets adapter
├── ports/
│   ├── interfaces.go              # Port interfaces (Publisher, SecretProvider, StravaClient, TokenStore)
│   └── portstest/mocks.go         # Shared test mocks
├── types/generated/webhook.pb.go  # Generated protobuf types
├── config/config.go               # Configuration loading
└── Dockerfile                     # Cloud Run container
```

The [handler](adapters/http/handler.go) resolves the Strava subject through the
[connection registry](../../docs/guides/activity-connection-registry.md) before
checking the **app UID** allowlist. [CredentialOwner](ports/ownership.go) carries
that fixed UID/subject pair through credential reads, refresh retries, row
re-fetches and cleanup. Webhook envelopes and Strava calls retain provider IDs;
no UID is inferred from a subject.

The [token cache](adapters/cache/token_store.go) keys by the full pair and checks
live ownership on every hit. Misses read ownership and UID-keyed credentials in
one Firestore transaction; refresh writes and deletion recheck the pair on every
SDK retry. Cache TTLs bound out-of-process credential/admission changes, not
ownership changes. Primary-path mapping failures return 500 for redelivery; only
a missing credential document under a valid pair is a token orphan. See `webhook/owner_check`
for activity outcomes.

Gateway and dispatcher images require verified, sealed bootstrap evidence through
[the release declaration](../../scripts/ci/identity-rollout.json). Independent
enrollment and persistence/backfill ownership routing remain separate stages.

**Type Definitions:** Webhook types are defined in `schemas/proto/desirelines/webhook/v1/webhook.proto` and shared with stravapipe (Python). Generated code lives in `types/generated/`. See `just proto-gen-backend`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/webhook/{callback-capability}` | Strava subscription verification (hub.mode, hub.challenge, hub.verify_token) |
| `POST` | `/webhook/{callback-capability}` | Receive Strava webhook events |
| `GET` | `/health` | Health check endpoint |
| `HEAD` | `/` | Health probe for Cloud Run |

The capability URL is the only webhook route; plain `/webhook` is retired and
returns the same generic `404` as any unknown path. The callback capability is a
bearer credential and is required at startup — the dispatcher fails to boot
without a valid one rather than serving an unprotected route. Never print or
store the full callback URL in logs, traces, dashboards, or support artifacts.
Use the [callback-capability cutover runbook](../../docs/runbooks/webhook-callback-capability.md)
for activation, re-registration, rollback, and rotation.

## Deauthorization

Strava signals athlete deauthorization with an `athlete` webhook event — either
`aspect_type=delete` or an `update` whose payload carries
`updates={"authorized":"false"}` (handled in `adapters/http/handler.go`,
`handleAthleteEvent`). On deauth the dispatcher:

1. Resolves the active ownership pair and **confirms revocation with Strava**.
   An active grant is acknowledged without cleanup. Missing tokens cannot confirm
   revocation; mapping or backend failures return 500 for redelivery.
2. **Publishes** to `GCP_PUBSUB_DEAUTH_TOPIC`. If publication fails, tokens remain
   available so a redelivery can confirm and retry the handoff.
3. **Best-effort deletes** tokens at `users/{uid}/private/strava_tokens`, only
   while the original pair still matches, and invalidates the UID's admission
   cache entry. Downstream cleanup owns eventual deletion after the handoff.

Deauth deliberately bypasses app admission. Removing an app UID from the
allowlist must not strand a formerly admitted user's data when their Strava grant
is subsequently revoked. Grant confirmation and registry validation still apply.

`FIRESTORE_DATABASE` and `GCP_PUBSUB_DEAUTH_TOPIC` are fail-fast-required at
startup precisely because of this flow.

## Environment Variables

`config.LoadConfig` validates everything below up front. The service refuses to
start (fail-fast) if a required variable is missing, or if an optional one is set
to a value it can't parse, so a typo surfaces at boot instead of as a silent
default.

```bash
# Required (fail-fast)
GCP_PROJECT_ID=desirelines-dev
GCP_PUBSUB_TOPIC=desirelines_activity_events
GCP_PUBSUB_DEAUTH_TOPIC=desirelines_deauth_events
FIRESTORE_DATABASE=desirelines

# Activity-row publish to BigQuery (best-effort, alongside the primary publish)
ACTIVITY_ROW_PUBLISH_ENABLED=false   # Default: false. Also the kill switch: false stops it by config alone
GCP_PUBSUB_ACTIVITY_ROWS_TOPIC=desirelines-activity-rows-dev  # Required (fail-fast) when the publish is enabled
ACTIVITY_ROW_ENCODING=json           # "json" (default) or "proto"; must match what the topic accepts

# Firestore lookup caches. "0" disables a cache: the incident kill switch
ALLOWLIST_CACHE_TTL=5m   # Default: 5m
TOKEN_CACHE_TTL=5m       # Default: 5m

# HTTP server
HTTP_READ_TIMEOUT=30s          # Default: 30s
HTTP_WRITE_TIMEOUT=30s         # Default: 30s
HTTP_READ_HEADER_TIMEOUT=10s   # Default: 10s
MAX_REQUEST_BODY_SIZE=1048576  # Default: 1 MiB, in bytes

# Optional
LOG_LEVEL=INFO   # Default: INFO
PORT=8080        # Default: 8080 (Cloud Run sets this)
```

The activity-row publish is the only path by which activity rows reach BigQuery.
It is best-effort: a failed or skipped publish never fails the webhook. A dropped
create or update is made good by the activity's next event, if one comes; a
dropped delete never is (see `publishActivityRow` in `adapters/http/handler.go`).

### Secrets

The webhook and Strava API secrets are loaded from secret file mounts
(preferred) with environment variable fallback. `STRAVA_WEBHOOK_SUBSCRIPTION_ID`
and the verify token are loaded this way too (by the `env` secret cache) — they
are **not** plain config vars:

| Secret Mount | Env Var Fallback | Description |
|-------------|------------------|-------------|
| `/etc/secrets/INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN/value` | `STRAVA_WEBHOOK_VERIFY_TOKEN` | Webhook subscription verify token |
| `/etc/secrets/INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID/value` | `STRAVA_WEBHOOK_SUBSCRIPTION_ID` | Strava webhook subscription ID |
| `/etc/secrets/INFISICAL_STRAVA_WEBHOOK_CALLBACK_CAPABILITY/value` | `STRAVA_WEBHOOK_CALLBACK_CAPABILITY` | 32 random bytes encoded as 64 lowercase hex characters; required at startup |
| `/etc/secrets/INFISICAL_STRAVA_CLIENT_ID/value` | `STRAVA_CLIENT_ID` | Strava API app client ID |
| `/etc/secrets/INFISICAL_STRAVA_CLIENT_SECRET/value` | `STRAVA_CLIENT_SECRET` | Strava API app client secret |

## Development

### Local with docker-compose

```bash
# Start backend (includes PubSub emulator)
docker compose --profile backend up

# Test the webhook through the capability route (plain /webhook is retired and
# returns 404). Use a local capability; never paste a real one into shared output
curl -X POST "http://localhost:8081/webhook/$STRAVA_WEBHOOK_CALLBACK_CAPABILITY" \
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
STRAVA_WEBHOOK_CALLBACK_CAPABILITY=$(openssl rand -hex 32) \
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
