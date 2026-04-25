# 05. Developer Experience

> **Goal:** Make the inner loop fast and the outer loop reliable, so that future-you (and any AI assistant or contributor) can be productive in minutes, not hours.

This compounds with everything else: every other improvement on the list lands faster when DX is good.

## Why it matters

The repo already has `just`, Pants, `pre-commit`, Docker Compose, and a setup script — strong foundations. The gaps that bite are:

- **Pre-commit hooks aren't enforced in CI**, so an unformatted file fails on the slow `gofmt`/`ruff`/`eslint` jobs instead of the fast hook.
- **No devcontainer**, so a fresh clone (or an AI session on a clean VM) depends on whatever's installed locally.
- **No conventional-commit enforcement**, so changelog automation isn't possible later.
- **No top-level `CONTRIBUTING.md`**, so first-PR onboarding is "read 13 guide docs."

## Current state

- `.pre-commit-config.yaml` exists; not invoked in any GitHub Actions workflow.
- No `.devcontainer/devcontainer.json`.
- README mentions a contributing guide but there's no `CONTRIBUTING.md` at repo root.
- No commitlint or commit-msg hook.
- CI fans out into many jobs; no aggregated runtime/flake tracking.
- `just` and `pants` overlap in some commands without documented "use X for Y" guidance.

## Concrete steps

### 1. Add a devcontainer

`.devcontainer/devcontainer.json` with:

- Base: `mcr.microsoft.com/devcontainers/base:ubuntu-24.04`.
- Features: `ghcr.io/devcontainers/features/go:1` (pin 1.25), `python:1` (pin 3.13), `node:1` (pin 24), `docker-in-docker:1`, `terraform:1`.
- `postCreateCommand`: `./scripts/ops/setup/setup-local.sh`.
- VS Code extensions: Go, Python, ESLint, Prettier, Terraform, Pants.

This makes:
- VS Code Remote Containers → one-click setup.
- GitHub Codespaces → works out of the box.
- Claude Code on the web → reproducible environment, no flaky setup.

### 2. Run pre-commit in CI

Add a `pre-commit` job to `.github/workflows/ci.yml` that runs `pre-commit run --all-files`. Make it a `needs:` for the slower lint jobs so they fast-fail. Or use [pre-commit.ci](https://pre-commit.ci/) — it auto-fixes on PRs.

### 3. Write a top-level `CONTRIBUTING.md`

Aim for a 5-minute first-contribution path:

```markdown
# Contributing

## Quick start
1. Open the repo in a devcontainer (or run `./scripts/ops/setup/setup-local.sh`).
2. `just test` — should pass clean.
3. Pick an issue tagged `good-first-issue`.
4. Branch, change, `just lint && just test`, push, open PR.

## Where things live
- Backend: `packages/{dispatcher,apigateway,stravapipe,shared}`
- Frontend: `packages/web`
- Schemas: `schemas/{proto,database,bigquery}`
- Infra: `terraform/`

## Conventions
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.
- One PR per logical change.
- Tests required for new behavior.
- Prefer editing existing files to creating new ones.
```

Link from README.

### 4. Enforce conventional commits

Add [commitlint](https://commitlint.js.org/) as a CI job that runs on the PR title (or each commit). Failure mode: clear error message pointing at the spec. This is the prerequisite for step 5.

### 5. Automate releases with release-please

Once conventional commits are enforced, [release-please](https://github.com/googleapis/release-please) gives you:

- Auto-generated `CHANGELOG.md`.
- Versioned GitHub releases.
- Semver tags on Docker images (instead of just Git SHAs).

This unlocks "what changed between deploy A and deploy B" without `git log` archaeology.

### 6. Document the `just` vs `pants` split

`docs/guides/tooling.md`, one page. Suggested rule: `just` for everyday commands and orchestration; Pants for cross-package smart-test-selection (`pants --changed-since=main test`) and CI caching. Pick a default and a fallback for each common task and write it down.

### 7. Track CI health

Small workflow_dispatch script that queries GitHub's Actions API and reports:

- Median CI run time over the last 30 days.
- Job-level p95 duration.
- Top 5 flakiest jobs (most retries).

Run weekly, post to a `ci-health.md` artifact or a single GitHub issue you keep updating. Catch CI rot before it costs hours.

### 8. Pin GitHub Actions to SHAs

Cross-references [02-security](02-security.md) step 8 — also a DX win because Renovate handles the upgrade flow once it's set up. Update `renovate.json`:

```json
"pinDigests": true
```

### 9. Add `just doctor`

A single command that prints the version of every required tool and flags missing ones. First thing a new contributor (or AI) runs when something doesn't work.

```just
doctor:
    @go version
    @python --version
    @node --version
    @pants --version
    @just --version
    @docker version --format '{{{{.Server.Version}}}}'
    @gcloud --version | head -1
    @echo "✓ All tools present"  # or fail loudly with what's missing
```

## What to skip

- **Don't** introduce a monorepo tool beyond what you have. Pants + just is already doing the job.
- **Don't** auto-deploy on every merge. The current GitOps approach is right; just add release tags.
- **Don't** invest in custom dev tooling beyond a devcontainer until there's a second contributor.

## References

- Dev Containers spec: https://containers.dev/
- GitHub Codespaces with devcontainers: https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration
- pre-commit.ci: https://pre-commit.ci/
- Conventional Commits: https://www.conventionalcommits.org/en/v1.0.0/
- commitlint: https://commitlint.js.org/
- release-please: https://github.com/googleapis/release-please
- DORA metrics (the "DevEx" research foundation): https://dora.dev/
- "Five Lines of Code" (M. Clausen) for refactor heuristics applicable to tooling cleanup. ISBN 978-1617298318.
