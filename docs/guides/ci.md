# CI/CD Guide

CI/CD workflows for Desirelines using GitHub Actions.

## Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR, push to main | Tests, lint, validate |
| `deploy.yml` | Push to main, manual | Build images, deploy |
| `drift-detection.yml` | Daily 8am UTC, manual | Detect terraform drift |

## Concurrency

Workflows use concurrency groups to prevent conflicts:
- **CI**: Cancels in-progress runs on same branch (fast feedback)
- **Deploy**: Queues deployments to same environment (no cancel)
- **Drift**: Single run at a time

## Overview

CI runs on every pull request and push to main via GitHub Actions (`.github/workflows/ci.yml`). The workflow uses:
- **Pants** for Python (unified configuration, prevents config drift)
- **Native Go tooling** for Go (6x faster, better multi-module support)
- **Standard npm** for React/Web (mature tooling)
- **Terraform CLI** for infrastructure validation

**Branch Protection:** Tests must pass before merging to main. Deployment workflow does not re-run tests.

## CI Workflow Jobs

### 1. Sport Config Sync
Verifies `sport_types.json` copies are synchronized across packages.

```bash
make verify-sport-config
```

**Why:** Ensures config consistency between Python and Go packages.

### 2. Python (Pants)
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

### 3. Go Tests
Native Go testing with coverage, runs in parallel for each package.

```bash
# Run locally
cd packages/dispatcher && go test -v -race -coverprofile=coverage.out ./...
cd packages/apigateway && go test -v -race -coverprofile=coverage.out ./...

# Or use make targets
make go-test
```

**Matrix strategy:** Runs `dispatcher` and `apigateway` tests in parallel.

**Why native Go:**
- ~6x faster than Pants Go backend (1min vs 6-7min)
- Better multi-module workspace support
- Pants Go support is experimental

**Coverage:** Uploaded to Codecov per package.

### 4. Go Lint
Runs `golangci-lint` for each Go package with inline PR annotations.

```bash
# Run locally
cd packages/dispatcher && golangci-lint run
cd packages/apigateway && golangci-lint run

# Or use make target
make go-lint
```

**Configuration:** `.golangci.yml` in repository root.

**Format check:** Uses `gofmt -l` to verify Go code formatting.

**Why separate from Pants:** Pants golangci-lint backend doesn't support multi-module repos (`go.work`).

### 5. Web/React Quality
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

### 6. Terraform Validation
Validates Terraform configuration for all environments.

```bash
# Validates local, dev, prod environments + module
cd terraform/environments/{env}
terraform fmt -check
terraform init -backend=false
terraform validate
```

**Why:** Catches Terraform syntax errors before deployment.

### 7. BUILD File Validation
Ensures Pants BUILD files are up to date.

```bash
# Run locally
pants tailor --check ::
```

**Why:** Catches missing BUILD files or outdated configurations.

**Fix:** Run `pants tailor ::` to update BUILD files.

## Running CI Locally

### Full CI Suite
```bash
# Mimics entire CI workflow
make test           # All tests (Python, Go, Web)
make lint           # All linting
make py-typecheck   # Python type checking
make tf-validate-all # Terraform validation
```

### Individual Checks
```bash
# Python only
pants test packages/stravapipe::
pants lint packages/stravapipe::
pants check packages/stravapipe::

# Go only
make go-test
make go-lint

# Web only
cd packages/web
npm run test:coverage
npm run lint
npm run typecheck

# Terraform only
make tf-validate-all
```

## CI Performance

### Typical Run Times
- **Python (Pants):** 2-3 min (first run), 1-2 min (cached)
- **Go Tests:** ~1 min per package (parallel: ~1 min total)
- **Go Lint:** ~30-45 sec per package (parallel: ~45 sec total)
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
2. **Environment variables** - Check `.github/workflows/ci-pants.yml` env vars
3. **Python version** - CI uses Python 3.12, check local version
4. **Go version** - CI uses Go 1.25, check local version

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
2. **Run tests locally** - `make test` or specific test commands
3. **Fix issues** - Address any failures
4. **Run formatters** - `make format` (Python + Go)
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

The `deploy.yml` workflow handles deployments:

| Trigger | Environment | Behavior |
|---------|-------------|----------|
| Push to main | dev | Automatic |
| Manual dispatch | dev or prod | Choose environment |

**Steps:**
1. Build Docker images with Pants
2. Push to Artifact Registry
3. Run `terraform apply` with git SHA as version
4. Verify Cloud Run services are healthy

## Drift Detection

The `drift-detection.yml` workflow runs daily to detect infrastructure drift:

- Runs `terraform plan` for dev and prod
- Creates GitHub issue if changes detected
- Can be triggered manually via workflow dispatch

Check drift locally:
```bash
make tf-dev-drift
make tf-prod-drift
```

## Related Documentation

- [Deployment Guide](./deployment.md) - Manual deployment procedures
- [Testing Guide](../testing-guide.md) - Detailed testing documentation
- [Terraform README](../../terraform/README.md) - Terraform operations
- [Pants Documentation](https://www.pantsbuild.org/docs) - Official Pants docs
