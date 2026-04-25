# 02. Supply-Chain & App-Sec Hardening

> **Goal:** Catch a vulnerable dependency or a leaked secret before it reaches `main`, and harden the few HTTP-layer details that aren't in place yet.

Most of this is CI YAML and a small middleware. High confidence-per-hour.

## Why it matters

The internal hygiene of the app is solid — parameterized SQL in `packages/apigateway/adapters/postgres/repository.go`, a whitelisted update-clause list in stravapipe's `_ALLOWED_UPDATE_CLAUSES`, distroless containers, WIF for GCP auth. The gap is **external attestation**: nothing scans dependencies or generated code, images aren't signed, the apigateway doesn't set common HTTP security headers, and Go HTTP handlers have no panic recovery. For a service that receives third-party webhooks and stores OAuth refresh tokens, that's the most likely class of regression.

## Current state

- `.github/workflows/ci.yml` runs `golangci-lint` (which bundles `gosec` locally) but does **not** run CodeQL, Semgrep, or Trivy/Grype.
- `deploy.yml` builds and pushes images but doesn't sign them, scan them, or generate an SBOM.
- No `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or `Content-Security-Policy` headers in `apigateway`.
- No `recover()` middleware in chi — a panic in one request takes down the goroutine and may disrupt in-flight work.
- No secret-scanning step (Gitleaks/TruffleHog) on PRs.
- Strava webhook signature verification is documented in `docs/guides/strava-webhook.md` but not asserted by tests.

## Concrete steps

### 1. Add CodeQL

New workflow `.github/workflows/codeql.yml` with three matrices: `go`, `python`, `javascript-typescript`. First-party, free, runs on every PR. Fail PRs on `error`-severity findings; let `warning`-severity show up as PR annotations.

### 2. Add Trivy in `deploy.yml`

After `docker build`, before `docker push`. Fail on `CRITICAL` CVEs **only** if a fixed version exists (`--ignore-unfixed`). Run for all three images (`dispatcher`, `apigateway`, `stravapipe`).

### 3. Add Gitleaks

A pre-commit hook **and** a CI job. Pre-commit catches it before push; CI catches forks and bypassed hooks. Use the maintained `gitleaks/gitleaks-action`.

### 4. Add a security-headers middleware in `apigateway`

In `cmd/apigateway/main.go` (or a new `middleware/security.go`), wrap chi with:

```go
w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
w.Header().Set("X-Content-Type-Options", "nosniff")
w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
```

Add CSP **last**, in `Content-Security-Policy-Report-Only` mode first so you can tune it without breaking the SPA. Test with a request that asserts each header is present.

### 5. Add panic recovery middleware

Use `chi/middleware.Recoverer` or write a thin wrapper that:

- Calls `recover()`.
- Logs `slog.Error("panic", "request_id", id, "stack", string(debug.Stack()))`.
- Returns 500 with a generic body.

Apply globally in `cmd/apigateway/main.go` and `cmd/dispatcher/main.go`. Add a unit test that triggers a panic and asserts 500.

### 6. Verify Strava webhook signature in code

Currently the verify-token check happens at subscription registration. Add an HMAC check on every webhook delivery in `dispatcher` (or confirm it's there and add a unit test for a forged signature). Reject with 401 and a structured log line.

### 7. SBOM + signed images (when you have an hour)

In `deploy.yml`:

- Generate an SBOM with [Syft](https://github.com/anchore/syft): `syft <image> -o spdx-json > sbom.spdx.json`.
- Push as an OCI artifact alongside the image.
- Sign with `cosign sign` using keyless OIDC from GitHub Actions (no key management required).

This puts you on the path to SLSA Build L2/L3 with low ongoing cost.

### 8. Pin GitHub Actions to SHAs, not tags

`actions/checkout@v4` → `actions/checkout@<commit-sha>`. Renovate already handles this if you add `pinDigests: true` to `renovate.json`. Mitigates supply-chain attacks via tag rewrites.

## What to skip

- **Don't** introduce a WAF — Cloud Run with Firebase Hosting in front is fine.
- **Don't** add Snyk/Sonatype paid tools yet — the free tools above cover ~95%.
- **Don't** try to write a perfect CSP on day one. Start in report-only.

## References

- GitHub CodeQL setup (advanced workflow): https://docs.github.com/en/code-security/code-scanning/creating-an-advanced-setup-for-code-scanning
- Trivy: https://trivy.dev/
- Gitleaks Action: https://github.com/gitleaks/gitleaks-action
- OWASP Secure Headers Project (canonical header reference): https://owasp.org/www-project-secure-headers/
- MDN CSP guide (most readable CSP explainer): https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- chi Recoverer: https://github.com/go-chi/chi/blob/master/middleware/recoverer.go
- SLSA framework: https://slsa.dev/spec/v1.0/
- Sigstore cosign keyless signing: https://docs.sigstore.dev/cosign/signing/overview/
- Anchore Syft (SBOM): https://github.com/anchore/syft
- Strava webhook signature docs: https://developers.strava.com/docs/webhooks/
- OWASP ASVS (use as a checklist, not a project): https://owasp.org/www-project-application-security-verification-standard/
