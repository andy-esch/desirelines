# API Gateway Improvements

Five focused proposals to raise the bar on `packages/apigateway` specifically. Synthesized from a deep audit of the package — file paths and line numbers are real.

The package is **already well-engineered**: hexagonal layering is clean, SQL is parameterized, auth middleware is dependency-injected, OTel + structured logging are wired, and test coverage is solid. These are the upgrades that matter most.

## Index

1. **[Repository & Query Layer Hardening](01-repository-layer.md)** — Replace the hand-rolled queryBuilder, parameterize date-range queries, add slow-query logging, harden cursor decoding. Single biggest code-quality lift.
2. **[Auth & OAuth Flow Hardening](02-auth-hardening.md)** — Session-bind the state token, fix scope parsing for OAuth2 spec compliance, token-refresh strategy, OAuth-specific rate limiting.
3. **[API Contract & Response Consistency](03-api-contract.md)** — Adopt RFC 7807 problem details, unify on camelCase, make `openapi.yaml` the source of truth for frontend types, validate spec ↔ handlers in CI.
4. **[Cloud Run Runtime Engineering](04-cloud-run-runtime.md)** — Pool min-conns for cold starts, pgx OTel instrumentation, real downstream health checks, request-ID through DB spans.
5. **[Configuration & Startup Invariants](05-config-and-startup.md)** — Centralize a typed `Environment` enum, validate embedded sport config at build time, fail fast on misconfig.

## Suggested sequencing

| Phase | Focus | Why |
|---|---|---|
| Now | #2 + #5 | Auth bugs and config drift are the failure modes most likely to bite production. Both small. |
| Next | #1 | Repository layer is the biggest code-quality cleanup; touches a lot of files but each change is mechanical. |
| Then | #3 | Pairs with frontend work — landing this unlocks generated TypeScript types from `openapi.yaml` (see project [#3 Testing](../03-testing.md)). |
| Then | #4 | Cloud Run tuning is empirical — needs the benchmarks from project [#4 Performance](../04-performance.md) first. |

## Findings not in the top 5

Worth knowing about but not high enough impact for their own document:

- **Container security headers gap** — `internal/server/middleware.go:30` only sets HSTS and `X-Content-Type-Options`. Add `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), microphone=(), camera=()`. Also covered in project [#2 Security](../02-security.md).
- **Local replace directive in go.mod** — `go.mod:81` uses `replace ../shared`. Fragile in Docker. Convert to module versioning once the shared package stabilizes.
- **No `govulncheck` in CI** — adds one line; covered in project [#2 Security](../02-security.md).
- **Mock repositories don't validate parameters** — `handler_test.go:44`. Tests pass even if a handler calls the repo with the wrong user ID.
- **No concurrent-request stress tests** — `-race` is on but no test exercises 10 simultaneous requests against a single handler.
- **No `/debug/pprof` endpoint** — fine to leave off until you actually have a memory issue to chase.
- **JSON encoding via stdlib** — `internal/activities/helper.go:20`. `segmentio/encoding` is faster but maintainability beats micro-optimization here.

## Status tracking

Same convention as the project-level proposals — tick boxes inline in each doc as steps land:

```markdown
- [x] Step 1 — landed in #123
- [ ] Step 2
```
