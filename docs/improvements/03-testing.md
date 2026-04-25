# 03. Cross-Service Contract & End-to-End Testing

> **Goal:** Catch the class of bug that lives *between* services — a producer emitting a sport type the consumer's whitelist doesn't know about, or `apigateway` removing a field that `web/` was silently relying on.

## Why it matters

Five services share a Protocol Buffers contract, a Pub/Sub topology, and a Postgres schema. Each is tested in isolation. `buf breaking` catches *wire* breakage on the proto, but it doesn't catch *semantic* breakage — a new enum variant that no consumer handles, or an API field rename that compiles on both sides because TypeScript doesn't know about the Go change.

This is the highest-ROI gap in the test suite: a single broken contract can corrupt the BigQuery lake or blank out a dashboard, and it's invisible until you happen to look at the chart.

## Current state

- Strong unit tests across all services (web 77 files, stravapipe 42, apigateway 24, dispatcher 10).
- `integration-tests` job in `ci.yml` runs Go + Python tests against a real Postgres — but **scoped to single services**.
- Web has a `test:integration` script (Firebase emulator) that **isn't invoked in CI**.
- `buf breaking` runs against `main` — wire-level only.
- No end-to-end test that exercises `webhook → dispatcher → Pub/Sub → writer → Postgres → apigateway`.
- TypeScript types in `web/` are hand-written or generated locally; no build-time check that they match `openapi.yaml`.
- No fixture library of canonical Strava webhook payloads shared across language boundaries.

## Concrete steps

### 1. One end-to-end test through the full pipeline

This is the single highest-leverage addition.

Create `tests/e2e/pipeline_test.go` (or `.py`) that, against the existing Docker Compose stack:

1. POSTs a realistic Strava webhook body to `dispatcher`.
2. Polls Postgres until the activity row appears (or times out at 30s).
3. Calls `apigateway` `/activities/{id}` and asserts the response shape.
4. Calls `/aggregates/daily_summary` and asserts the new activity is included.

Add a `e2e-tests` job to `ci.yml` with a 10-minute budget. One test catches ~80% of cross-service regressions.

### 2. Generate TypeScript types from `openapi.yaml`

In `packages/web`, add `openapi-typescript` as a dev dependency and a script:

```json
"types:openapi": "openapi-typescript ../apigateway/openapi.yaml -o src/types/api.ts"
```

Run it in CI and fail if `src/types/api.ts` is out of date (`git diff --exit-code`). Replace ad-hoc API response interfaces in `web/` with the generated types.

This catches API drift at compile time with zero runtime overhead and no contract broker to operate.

### 3. Shared canonical event fixtures

Create `schemas/proto/testdata/` with one JSON file per event variant — at minimum:

- `webhook_create_activity.json`
- `webhook_update_activity.json`
- `webhook_deauth.json`
- One per supported sport type.

Both Go and Python tests load from this directory. When you add a new sport type, you add a fixture and **every consumer's test suite fails until it handles it.**

### 4. Cross-language sport-config invariant test

`packages/apigateway/config/sport_config.go` and the equivalent Python loader both consume the same YAML. Write a single test (in either language) that loads the file and asserts the set of recognized sport types matches a checked-in golden list. Ensures nobody adds a sport in YAML without updating consumer code.

### 5. Enable web's Firebase-emulator integration tests in CI

Tests already exist under `packages/web/`. Add a `web-integration` job to `ci.yml` that runs them. Use the same `tmpfs` trick as the Postgres integration job for speed.

### 6. Pub/Sub message-attribute contract tests

For every consumer in stravapipe, add a test that loads a fixture from `schemas/proto/testdata/` and asserts:

- All required attributes are present and parseable.
- An unknown attribute doesn't crash the consumer.
- A missing required attribute fails loudly (not silently).

This is ~30 lines of test code that locks down the contract.

### 7. (Stretch) Mutation testing on critical paths

Once the e2e test exists, run [mutmut](https://mutmut.readthedocs.io/) (Python) or [go-mutesting](https://github.com/avito-tech/go-mutesting) on:

- Cumulative-metric SQL builders (`apigateway/repository/`).
- Sport normalization and config loading.
- OAuth token refresh in stravapipe.

Mutation testing tells you whether 90% line coverage is real coverage or just exercise. Don't run it in CI — it's slow — run it occasionally and treat findings as targeted test gaps.

## What to skip

- **Don't** adopt Pact + a contract broker. Generated types from OpenAPI is 90% of the value at 10% of the operational cost.
- **Don't** try for 100% e2e coverage. One happy-path e2e per major flow plus targeted contract tests is the right balance.
- **Don't** mock GCP services in e2e — use the emulators (`pubsub-emulator`, `firestore-emulator` — already in `docker-compose.yml`).

## References

- Martin Fowler, "ContractTest" (the tradeoff space): https://martinfowler.com/bliki/ContractTest.html
- Martin Fowler, "Consumer-Driven Contracts": https://martinfowler.com/articles/consumerDrivenContracts.html
- openapi-typescript: https://github.com/openapi-ts/openapi-typescript
- Google Cloud Pub/Sub emulator: https://cloud.google.com/pubsub/docs/emulator
- Firebase Emulator Suite: https://firebase.google.com/docs/emulator-suite
- Testcontainers for Go (if you outgrow `docker-compose.yml`): https://golang.testcontainers.org/
- Testing pyramid revisited (Honeycomb's "Test Pyramid Is Outdated"): https://www.honeycomb.io/blog/test-in-production
- mutmut: https://mutmut.readthedocs.io/
