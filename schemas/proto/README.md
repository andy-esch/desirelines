# Protocol Buffer Schemas

Cross-language type definitions for Desirelines services.

## Directory Structure

The directory structure mirrors protobuf package names (`desirelines.<domain>.v1`):

```
schemas/proto/
├── buf.yaml                              # Buf linting config
├── BUILD                                 # Pants build targets
└── desirelines/
    ├── config/
    │   └── v1/
    │       └── user_config.proto         # User settings (Firestore)
    ├── sports/
    │   └── v1/
    │       └── sports_metrics.proto      # Activity metrics API
    └── webhook/
        └── v1/
            └── webhook.proto             # Strava webhook events
```

## Files

| File | Package | Consumers | Status |
|------|---------|-----------|--------|
| `desirelines/sports/v1/sports_metrics.proto` | `desirelines.sports.v1` | apigateway (Go), web (TS), stravapipe (Python) | Active |
| `desirelines/config/v1/user_config.proto` | `desirelines.config.v1` | apigateway (Go), web (TS) | Active |
| `desirelines/webhook/v1/webhook.proto` | `desirelines.webhook.v1` | dispatcher (Go), stravapipe (Python) | Active |

## `sports_metrics.proto`

Defines the `/activities/{year}/metrics?sport={sport}` API response.

**Key types:**

- `SportMetrics` - Timeseries array returned by API
- `CumulativeMetricsEntry` - Single data point (date, distance, elevation, time, activities)
- `YearMetadata` - Year summary with per-sport totals

**Producer:** `api-gateway` queries PostgreSQL → returns `SportMetrics`
**Consumer:** `web` frontend fetches and renders charts

## `user_config.proto`

Defines user configuration stored in Firestore.

**Key types:**

- `UserConfig` - Root document with goals, preferences, annotations
- `Goal` - Year-specific distance goals
- `Annotation` - Chart annotations

**Storage:** Firestore `users/{userId}/config/v1`

## `webhook.proto`

Defines the canonical Strava webhook event structure shared between Go and Python.

**Key types:**

- `WebhookEvent` - Strava webhook notification (create/update/delete)
- `EnrichedEvent` - Wraps `WebhookEvent` with optional `raw_activity` bytes (Strava API JSON). The dispatcher enriches CREATE events with the full activity payload so downstream consumers don't need Strava API credentials.
- `AspectType` - Enum: CREATE, UPDATE, DELETE
- `ObjectType` - Enum: ACTIVITY, ATHLETE
- `ActivityUpdates` - Fields that can change on UPDATE (title, type, private)
- `WebhookVerificationRequest/Response` - Subscription verification

**Flow:** Strava webhook → dispatcher (Go) enriches with activity data → publishes `EnrichedEvent` to PubSub → bq-inserter and postgres-writer (Python) consume

**Adapter locations:**

- Go: `packages/dispatcher/adapters/proto/` - JSON ↔ proto conversion
- Python: `packages/stravapipe/src/stravapipe/adapters/proto/` - dict/Pydantic ↔ proto conversion

## Code Generation

```bash
# Generate all (backend + web)
just proto-gen

# Backend only (Go + Python via Pants)
just proto-gen-backend

# Web only (TypeScript via protoc)
just proto-gen-web

# Maintenance
just proto-fmt    # Format proto files
just proto-lint   # Lint proto files
```

**Generated code locations:**

- Go (apigateway): `packages/apigateway/types/generated/`
- Go (dispatcher): `packages/dispatcher/types/generated/`
- Python: `packages/stravapipe/src/stravapipe/types/generated/`
- TypeScript: `packages/web/src/types/generated/`

## Related

- [API Gateway handlers](../../packages/apigateway/internal/)
- [Dispatcher proto adapter](../../packages/dispatcher/adapters/proto/)
- [Stravapipe proto adapter](../../packages/stravapipe/src/stravapipe/adapters/proto/)
- [Frontend API client](../../packages/web/src/api/activities.ts)
- [Frontend types](../../packages/web/src/types/generated/)
