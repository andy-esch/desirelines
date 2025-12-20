# Protocol Buffer Schemas

API contracts between `api-gateway` (Go) and `web` frontend (TypeScript).

## Files

| File | Purpose | Status |
|------|---------|--------|
| `sports_metrics.proto` | Activity metrics API response | Active |
| `user_config.proto` | User settings (Firestore) | Active |

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
- Go: `packages/apigateway/types/generated/`
- Python: `packages/stravapipe/src/stravapipe/types/generated/`
- TypeScript: `packages/web/src/types/generated/`

## Related

- [API Gateway handler](../../packages/apigateway/handler.go)
- [Frontend API client](../../packages/web/src/api/activities.ts)
- [Frontend types](../../packages/web/src/types/generated/)
