# Project Improvements

Five focused proposals to raise the bar on desirelines, ordered by impact-per-effort. Each doc is self-contained: context, current state, concrete steps, and references.

The project is already well-engineered (hexagonal architecture, comprehensive docs, structured logging, OTel, Renovate, distroless containers). These are upgrades, not fixes.

## Index

1. **[Lightweight Observability](01-observability.md)** — Know when something breaks before users do. No SLO theatre; just alerts, a dashboard, and a one-page runbook per failure mode.
2. **[Supply-Chain & App-Sec Hardening](02-security.md)** — CodeQL, image scanning, SBOMs, security headers, panic recovery. Mostly CI YAML; high confidence per hour spent.
3. **[Cross-Service Contract & E2E Testing](03-testing.md)** — One end-to-end test through the full webhook pipeline, plus generated TS types from `openapi.yaml`. Closes the biggest remaining test gap.
4. **[Performance: Caching, Benchmarks, Indexes](04-performance.md)** — Wire the Redis service that's already in compose, add ETag/Cache-Control, commit benchmarks, audit indexes.
5. **[Developer Experience](05-developer-experience.md)** — Devcontainer, pre-commit in CI, conventional commits, contributor guide.

## Suggested sequencing

| Phase | Focus | Why |
|---|---|---|
| Now | #1 + #2 | Both are mostly YAML/Terraform — parallelizable, no app-code risk. You'll feel the benefit the first time something misbehaves. |
| Next | #3 | Unlocks safer refactoring for the perf and DX work. |
| Then | #4 | Data-driven — don't cache until you've measured. Benchmarks come first. |
| Ongoing | #5 | Compounds with every contributor (including AI assistants). |

## How to use these docs

- Each numbered doc has a **Concrete steps** section with ordered, actionable items.
- Steps are sized to be ~half-day to one-day chunks.
- Where a step changes app code, the relevant file path is named.
- References at the end of each doc are authoritative external sources, not blog posts.

## Per-package proposals

Some packages have their own deeper audit:

- **[API Gateway](apigateway/README.md)** — top five for the `packages/apigateway` Go service: repository-layer hardening, OAuth flow, API contract, Cloud Run runtime, config & startup invariants.

## Status tracking

These are proposals, not commitments. Track adoption by ticking boxes inline in each doc as steps land, or by linking PRs from this index. Suggested convention:

```markdown
- [x] Step 1 — landed in #123
- [ ] Step 2
```
