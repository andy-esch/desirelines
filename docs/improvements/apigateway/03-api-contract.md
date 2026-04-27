# 03. API Contract & Response Consistency

> **Goal:** One response shape, one casing, one source of truth. Make the OpenAPI spec the contract that drives both server tests and client types.

## Why it matters

Today the apigateway emits two different JSON shapes depending on success or failure, with two different casing conventions:

```json
// success (camelCase, from protojson)
{ "year": 2024, "sports": [{"sportType": "Run"}] }

// error (snake_case, from apierrors)
{ "error": "Invalid year", "code": "BAD_REQUEST" }
```

Every frontend caller ends up writing `if (response.error)` branches that test for both shapes. Worse, `openapi.yaml` documents one of these but the handlers occasionally drift. This class of bug is invisible until a user sees a blank chart.

A small standardization wins back significant frontend complexity and gives you compile-time drift detection.

## Current state

- `internal/activities/handler.go:122` and elsewhere — error responses go through `apierrors.WriteError()` (shared package). Shape: `{"error": "...", "code": "..."}` in snake_case.
- Success responses use `protojson` with `UseProtoNames: false` → camelCase.
- `openapi.yaml` exists at the package root but isn't validated against the actual handlers in CI.
- Frontend types in `packages/web` are hand-maintained; nothing forces them in sync with `openapi.yaml`.
- No `Problem Details` (RFC 7807) — the de facto standard for HTTP error responses.
- Some endpoints (audit unclear — needs follow-up) may bypass `apierrors.WriteError` and call `http.Error` directly; the audit flagged this as a risk but didn't enumerate every site.

## Concrete steps

### 1. Adopt RFC 7807 Problem Details for errors

Update the shared `apierrors` package to emit:

```json
{
  "type": "https://desirelines.app/errors/invalid-year",
  "title": "Invalid year",
  "status": 400,
  "detail": "Year must be between 2000 and 2050",
  "instance": "/api/v1/aggregates/metrics?year=1850",
  "code": "INVALID_YEAR"
}
```

Set `Content-Type: application/problem+json` on error responses (per RFC 7807). The `code` field is your own taxonomy for client-side switching; everything else is standard.

This change is mostly in `packages/shared/apierrors/`. Add a unit test that asserts every documented error code in `openapi.yaml` is producible by the handlers.

### 2. Unify on camelCase everywhere

Same `protojson` config used for success responses should power error serialization. After step 1, the `Problem` struct should marshal `type`, `title`, `status`, `detail`, `instance`, `code` — all already lowercase, so no conflict.

If any handler is currently emitting snake_case via `apierrors`, this is the moment to standardize. Add a single CI check that greps `*_test.go` golden files for snake_case keys (heuristic: `"[a-z]+_[a-z]"` in JSON test fixtures) and flags review.

### 3. Audit every error path in CI

A test harness in `internal/handler_contract_test.go` that:

1. Registers all handlers via the real router.
2. For each documented error response in `openapi.yaml`, makes a request that should produce it.
3. Asserts `Content-Type: application/problem+json` and presence of the required fields.

This catches the "leaked `http.Error()` call" class of bug at PR time.

### 4. Validate `openapi.yaml` against handlers in CI

Two complementary checks:

- **Lint the spec:** `redocly lint openapi.yaml` or `spectral lint openapi.yaml`. Fails on missing examples, schemas, or descriptions.
- **Validate request/response conformance:** [`oapi-codegen`](https://github.com/oapi-codegen/oapi-codegen) can generate Go types from the spec; if you generate handler interfaces too, the compiler enforces conformance. Heavier lift but durable.

Lighter alternative: a single Go test that boots the router, hits every documented path with a documented payload, and validates the response against the spec using [kin-openapi](https://github.com/getkin/kin-openapi). About 100 lines, runs in seconds.

### 5. Generate frontend types from `openapi.yaml`

Cross-references project [#3 Testing](../03-testing.md) step 2. In `packages/web`:

```json
"scripts": {
  "types:openapi": "openapi-typescript ../apigateway/openapi.yaml -o src/types/api.ts"
}
```

CI fails if the generated file is stale (`git diff --exit-code`). Replace hand-written API types in `web/` with imports from `src/types/api.ts`.

### 6. Add API versioning before the next breaking change

Today routes are mounted under `/api/`. Move them under `/api/v1/`:

- Keep the chi sub-router pattern; just add one more `r.Route("/v1", ...)` level.
- Update `openapi.yaml` `servers` block.
- Update `frontend-local-dev.md` and `deployment.md` references.

Cost is small now. Cost grows every month you wait.

### 7. Standardize pagination envelope

The cursor-based list endpoints return data directly with cursor headers (or fields — confirm in handler). Pick one and document it:

```json
{
  "items": [...],
  "pagination": {
    "nextCursor": "eyJ...",
    "hasMore": true
  }
}
```

This pattern survives across the v1 endpoints and matches what TanStack Query's `useInfiniteQuery` expects.

## What to skip

- **Don't** adopt GraphQL. Overhead exceeds benefit at this size.
- **Don't** introduce a separate "API gateway" service in front of this one (it's already named that — but you don't need a Kong/Apigee).
- **Don't** version with headers (`Accept: application/vnd.desirelines.v1+json`). URL versioning is simpler and works better with caching.

## References

- RFC 7807 — Problem Details for HTTP APIs: https://datatracker.ietf.org/doc/html/rfc7807
- RFC 9457 — supersedes RFC 7807 (nearly identical, slightly clearer): https://datatracker.ietf.org/doc/html/rfc9457
- Redocly OpenAPI lint: https://redocly.com/docs/cli/commands/lint/
- Stoplight Spectral: https://github.com/stoplightio/spectral
- kin-openapi (Go OpenAPI 3 toolkit): https://github.com/getkin/kin-openapi
- oapi-codegen (Go server/client generation): https://github.com/oapi-codegen/oapi-codegen
- openapi-typescript (TS types from OpenAPI): https://github.com/openapi-ts/openapi-typescript
- Google AIP-158 (pagination patterns): https://google.aip.dev/158
- Stripe API design ("URL versioning + dated changes"): https://stripe.com/blog/api-versioning
