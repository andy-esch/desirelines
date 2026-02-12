# CI/CD Guide

CI/CD workflows for Desirelines using GitHub Actions.

## Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR, push to main | Tests, lint, validate |
| `deploy.yml` | Push to main | Build images, trigger deploy repo |

## Concurrency

Workflows use concurrency groups to prevent conflicts:
- **CI**: Cancels in-progress runs on same branch (fast feedback)
- **Deploy**: Queues builds (no cancel)

## Overview

CI runs on every pull request and push to main via GitHub Actions (`.github/workflows/ci.yml`). The workflow uses:
- **Pants** for Python (unified configuration, prevents config drift)
- **Native Go tooling** for Go (6x faster, better multi-module support)
- **Standard npm** for React/Web (mature tooling)
- **Terraform CLI** for infrastructure validation

**Branch Protection:** Tests must pass before merging to main. Deployment workflow does not re-run tests.

## CI Workflow Jobs

### 1. Validation
Combined job for schema sync, proto linting, and BUILD file checks. Fast checks run first (fail fast), slow BUILD check runs last.

```bash
# Run locally
just verify-schemas    # Check sport_types.json sync (~10 sec)
just proto-lint        # Lint proto files with buf (~10 sec)
pants tailor --check :: # Check BUILD files (~4 min)
```

**What it checks:**
- `sport_types.json` is identical across `schemas/sports/`, `packages/stravapipe/`, and `packages/apigateway/`
- Proto files pass buf lint rules
- Pants BUILD files are up to date

**Fix if failing:**
```bash
just sync-schemas      # Sync sport config + regenerate proto
just proto-fmt         # Format proto files
pants tailor ::        # Update BUILD files
```

### 2. Python
Tests, lints, and type-checks Python code using Pants.

```bash
# Run locally
pants test packages/stravapipe::
pants lint packages/stravapipe::
pants check packages/stravapipe::
```

**Tools used:**
- `pytest` - Testing framework
- `ruff` - Linting and formatting
- `mypy` - Static type checking
- Coverage uploaded to Codecov

**Configuration:**
- Single source of truth: `packages/stravapipe/pyproject.toml`
- Pants reads this config automatically (no drift between local/CI)

**Cache:**
- GitHub Actions cache via `pantsbuild/actions/init-pants@v10`
- Keyed by `packages/stravapipe/uv.lock` and `pants.toml`
- 30-60% speedup on cached runs

### 3. Go Quality
Combined testing, linting, and format checking for Go packages. Runs in parallel for each package via matrix strategy.

```bash
# Run locally
just go-test    # Tests for both packages
just go-lint    # Lint + format check for both packages
```

**Matrix strategy:** Runs `dispatcher` and `apigateway` in parallel.

**Checks performed (per package):**
1. `go test -v -race -coverprofile=coverage.out ./...`
2. `golangci-lint run` (with inline PR annotations)
3. `gofmt -l .` (format verification)

**Configuration:** `.golangci.yml` in repository root.

**Why native Go (not Pants):**
- ~6x faster than Pants Go backend
- Better multi-module workspace support (`go.work`)
- Pants Go support is experimental

**Coverage:** Uploaded to Codecov per package.

### 4. Web/React
Tests, lints, type-checks, and builds the React frontend.

```bash
# Run locally (from packages/web/)
npm run test:coverage
npm run lint
npm run format:check
npm run typecheck
npm run build
```

**Tools:**
- Vitest - Testing framework
- ESLint - Linting
- Prettier - Formatting
- TypeScript - Type checking

**Coverage:** Uploaded to Codecov.

### 5. Terraform
Validates Terraform configuration for modules and the artifacts environment (the only environment remaining in this repo).

```bash
# Run locally
just tf-validate-all
```

**Checks performed:**
- `terraform fmt -check` - Format validation
- `terraform init -backend=false` - Configuration loading
- `terraform validate` - Syntax and consistency

**Validated:** `environments/artifacts` and all modules. Dev/prod environments are in the private `desirelines-deploy` repo.

## Running CI Locally

### Full CI Suite
```bash
# Mimics entire CI workflow
just test           # All tests (Python, Go, Web)
just lint           # All linting
just py-typecheck   # Python type checking
just tf-validate-all # Terraform validation
```

### Individual Checks
```bash
# Python only
pants test packages/stravapipe::
pants lint packages/stravapipe::
pants check packages/stravapipe::

# Go only
just go-test
just go-lint

# Web only
cd packages/web
npm run test:coverage
npm run lint
npm run typecheck

# Terraform only
just tf-validate-all
```

## CI Performance

### Typical Run Times
- **Validation:** ~4-5 min (BUILD check is slowest; fast checks fail first)
- **Python:** 2-3 min (first run), 1-2 min (cached)
- **Go Quality:** ~2 min per package (parallel: ~2 min total)
- **Web/React:** 2-3 min
- **Terraform:** ~30 sec
- **Total:** ~5-7 min (parallel execution)

### Caching Strategy
**Python (Pants):**
- GitHub Actions cache automatically managed
- Caches: Pants binary, dependencies, build artifacts
- Cache key: `packages/stravapipe/uv.lock`, `pants.toml`
- Expected speedup: 30-60% on cache hits

**Go:**
- Standard `actions/setup-go@v5` caching
- Cache key: `go.work.sum`
- Caches: Go modules, build cache

**Web/React:**
- npm cache via `actions/setup-node@v4`
- Cache key: `packages/web/package-lock.json`

## Troubleshooting

### Python: Ruff Import Ordering Errors
**Error:** `I001 [*] Import block is un-sorted or un-formatted`

**Fix:** Add missing imports to `known-first-party` in `packages/stravapipe/pyproject.toml`:
```toml
[tool.ruff.lint.isort]
known-first-party = ["stravapipe", "tests"]
```

**Why:** Pants runs ruff from different context than `uv run ruff`.

### Go: BUILD File Errors
**Error:** `The target requires that there is a 'go_package' target defined`

**Fix:** Ensure `go_package()` is defined before `go_binary()`:
```python
# packages/dispatcher/cmd/dispatcher/BUILD
go_package()
go_binary(name="bin")
```

### BUILD Files Out of Sync
**Error:** `pants tailor --check ::` fails

**Fix:** Update BUILD files:
```bash
pants tailor ::
```

### CI Passes Locally But Fails in GitHub Actions
**Common causes:**
1. **Cache differences** - Try clearing local Pants cache: `rm -rf ~/.cache/pants`
2. **Environment variables** - Check `.github/workflows/ci.yml` env vars
3. **Python version** - Check CI workflow and local version match (see `.python-version`)
4. **Go version** - Check CI workflow and local version match (see `go.mod`)

### YAML Syntax Errors
**Error:** Pants commands with `::` fail

**Fix:** Quote commands containing `::`:
```yaml
run: "pants test ::"  # Correct
run: pants test ::    # Fails - YAML interprets :: as syntax
```

## Config Drift Prevention

**Problem:** When CI and local dev use different tool configurations, tests can pass locally but fail in CI.

**Solution:** Single source of truth for each tool:
- **Python:** `packages/stravapipe/pyproject.toml` (read by both Pants and uv)
- **Go:** `.golangci.yml` (read by both Pants and golangci-lint)
- **Web:** `packages/web/package.json` configs
- **Terraform:** Standard `.tf` files

**Pants benefits:**
- Reads existing tool configs (no duplication)
- Same commands work locally and in CI
- Centralized dependency management

## Development Workflow

### Making Changes
1. **Write code** - Make your changes
2. **Run tests locally** - `just test` or specific test commands
3. **Fix issues** - Address any failures
4. **Run formatters** - `just format` (Python + Go)
5. **Commit** - Commit your changes
6. **Push** - Push to GitHub
7. **CI runs** - GitHub Actions runs all checks
8. **Merge** - Once CI passes and approved, merge PR

### Pre-Commit Hooks

Pre-commit hooks run automatically on staged files:

```bash
# Install hooks (one-time)
pre-commit install

# Hooks run automatically on commit, or manually:
pre-commit run --all-files
```

**Configured hooks:**
- Python: `ruff` (lint + format)
- JavaScript: `prettier`, `eslint`
- Terraform: `terraform_fmt`, `terraform_validate`
- General: trailing whitespace, YAML/JSON validation

See `.pre-commit-config.yaml` for full configuration.

### Fast Feedback Loop
For rapid iteration:
```bash
# Only test what you're working on
pants test packages/stravapipe/tests/services/test_my_change.py

# Only lint specific files
pants lint packages/stravapipe/src/stravapipe/services/my_file.py
```

## Branch Protection Rules

The `main` branch requires:
- ✅ All CI jobs pass (Python, Go, Web, Terraform, BUILD files)
- ✅ At least one approving review
- ✅ Up-to-date with main

**Philosophy:** Tests enforce quality before merge. Deployment workflow focuses only on deployment.

## Deployment Workflow

The `deploy.yml` workflow handles build and deploy triggering:

| Trigger | Behavior |
|---------|----------|
| Push to main | Build images → push to Artifact Registry → trigger `desirelines-deploy` |

**Steps:**
1. Build Docker images with Pants
2. Push to Artifact Registry
3. Send `repository_dispatch` to `desirelines-deploy` via GitHub App token
4. Deploy repo handles terraform apply, service verification, web deploy, and state tracking

Terraform operations, drift detection, and deployment state tracking all live in the private `desirelines-deploy` repo.

## Related Documentation

- [Deployment Guide](./deployment.md) - Manual deployment procedures
- [Testing Guide](../testing-guide.md) - Detailed testing documentation
- [Terraform README](../../terraform/README.md) - Terraform operations
- [Pants Documentation](https://www.pantsbuild.org/docs) - Official Pants docs
