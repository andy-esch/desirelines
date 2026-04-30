# stravapipe — recommendations

A focused, opinionated set of improvements for `packages/stravapipe`. The
package is already in good shape — strict mypy, ruff with 23 rule categories,
hexagonal architecture, OTel tracing/metrics with correlation IDs propagated
through Pub/Sub attributes, and a sensible BigQuery staging+MERGE pattern.

The recommendations below target the gaps that move the needle most:
durability of the message pipeline, write semantics that scale, end-to-end
test confidence, runtime cost/efficiency on Cloud Run, and supply-chain
hygiene.

## Index

| # | Title | Severity | Effort |
|---|-------|----------|--------|
| 1 | [Durable Pub/Sub pipeline: DLQ contract, idempotency, bounded redelivery](./01-pubsub-durability.md) | High | Medium |
| 2 | [Migrate BigQuery writes to the Storage Write API](./02-bigquery-storage-write-api.md) | High | Medium–High |
| 3 | [Add HTTP integration tests + Strava API contract tests](./03-integration-and-contract-tests.md) | High | Medium |
| 4 | [Cut Cloud Run cold-start cost; consolidate FastAPI lifespans](./04-cold-start-and-app-factory.md) | Medium–High | Low–Medium |
| 5 | [Tighten supply chain & runtime config](./05-supply-chain-and-runtime-config.md) | Medium | Low |
| 6 | [Honorable mentions — small, high-leverage cleanups](./06-honorable-mentions.md) | Low–Medium | Low |

## Suggested ordering

1. **Pipeline durability (#1)** — pure code change, biggest correctness win,
   low risk.
2. **Test coverage gaps (#3)** — unblocks safe iteration on everything else.
3. **Cold-start + app factory (#4)** — visible latency improvement, sets up
   for multi-service simplification.
4. **BQ Storage Write API (#2)** — bigger lift, but pays back in $$$/month
   and removes the streaming-buffer special case.
5. **Supply chain + auth (#5)** — small PRs each, high security ROI.

## Honorable mentions

The smaller cleanups (backfill concurrency, pool metrics, Strava quota
metrics, `python-dotenv` in prod, backfill upsert N+1) are written up as
their own doc — see [06-honorable-mentions.md](./06-honorable-mentions.md).

## Audit context

These recommendations come from a technical audit covering: architecture,
reliability, performance, observability, testing, security, developer
experience, dependencies, type safety, and cost. Findings:

| Severity | Finding | File(s) |
|----------|---------|---------|
| High | Webhook signature / push-endpoint OIDC verification | `cloudrun/webhook_handler.py` |
| Medium | Code duplication across 3 FastAPI lifespans | `cloudrun/*.py` |
| Medium | Token storage lacks application-level encryption | `adapters/firestore/token_store.py` |
| Medium | No explicit Pub/Sub DLQ/poison pill contract in code | `cloudrun/` |
| Medium | Missing FastAPI endpoint integration tests | `tests/` |
| Low | `psycopg` + `psycopg-binary` redundancy | `pyproject.toml:25-26` |
| Low | Two lock files (`uv.lock` + `stravapipe.lock`) | repo root |
| Low | Backfill may have single-insert N+1 risk on duplicate check | `application/backfill/service.py:278` |
