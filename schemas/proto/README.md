# Protocol Buffer Schemas

Cross-language type definitions for Desirelines services.

## Files

| File | Purpose | Consumers | Status |
|------|---------|-----------|--------|
| `sports_metrics.proto` | Activity metrics API response | apigateway (Go), web (TS) | Active |
| `user_config.proto` | User settings (Firestore) | apigateway (Go), web (TS) | Active |
| `webhook.proto` | Strava webhook events | dispatcher (Go), stravapipe (Python) | Active |

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
- `AspectType` - Enum: CREATE, UPDATE, DELETE
- `ObjectType` - Enum: ACTIVITY, ATHLETE
- `WebhookVerificationRequest/Response` - Subscription verification

**Producer:** Strava API sends webhooks to dispatcher
**Consumer:** dispatcher (Go) receives and publishes to PubSub, stravapipe (Python) processes

**Adapter locations:**
- Go: `packages/dispatcher/adapters/proto/` - JSON ↔ proto conversion
- Python: `packages/stravapipe/src/stravapipe/adapters/proto/` - dict/Pydantic ↔ proto conversion

## Code Generation

```bash
# Generate all (Go, Python, TypeScript)
make proto-gen

# Individual targets
make proto-gen-go
make proto-gen-python
make proto-gen-typescript
```

**Generated code locations:**
- Go (apigateway): `packages/apigateway/types/generated/`
- Go (dispatcher): `packages/dispatcher/types/generated/`
- Python: `packages/stravapipe/src/stravapipe/types/generated/`
- TypeScript: `packages/web/src/types/generated/`

**Individual targets:**
```bash
make proto-gen-go-apigateway   # sports_metrics, user_config → apigateway
make proto-gen-go-dispatcher   # webhook → dispatcher
make proto-gen-python          # sports_metrics, webhook → stravapipe
make proto-gen-typescript      # sports_metrics, user_config → web
```

## Related

- [API Gateway handler](../../packages/apigateway/handler.go)
- [Dispatcher proto adapter](../../packages/dispatcher/adapters/proto/)
- [Stravapipe proto adapter](../../packages/stravapipe/src/stravapipe/adapters/proto/)
- [Frontend API client](../../packages/web/src/api/activities.ts)
- [Frontend types](../../packages/web/src/types/generated/)
