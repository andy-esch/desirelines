# shared

Shared Go packages for the desirelines monorepo.

## Packages

| Package | Description |
|---------|-------------|
| [allowlist](./allowlist/) | Shared interfaces + Firestore-backed implementation for athlete-allowlist enforcement across services |
| [apierrors](./apierrors/) | Standardized API error types and HTTP response writing, decoupled from any router or logging framework |
| [gcplog](./gcplog/) | Structured `slog` logging that emits JSON for GCP Cloud Logging (severity, timestamps, source locations) |
| [otel](./otel/) | OpenTelemetry metrics and tracing setup for GCP |
| [ratelimit](./ratelimit/) | Per-IP HTTP rate-limiting middleware (token bucket) for single-instance Cloud Run services |
| [secrets](./secrets/) | Load secrets from Infisical file mounts with environment-variable fallback for local dev |
| [stravatoken](./stravatoken/) | Shared types + Firestore path constants for Strava OAuth token storage (apigateway + dispatcher) |
| [ttlcache](./ttlcache/) | Small bounded, TTL-expiring key/value cache for read-through in front of Firestore lookups |

### Tooling

| Command | Description |
|---------|-------------|
| [`cmd/lintpub`](./cmd/lintpub/) | Thin `main` wrapper around the [`otel/lintpub`](./otel/lintpub/) analyzer, which flags PubSub `Publish` calls missing a paired trace-context `Inject`. Run via `just go-lintpub` (also wired into CI). |

## Usage

These packages are available to other modules in the monorepo via `go.work`. Import them directly:

```go
import "github.com/andy-esch/desirelines/packages/shared/gcplog"
```

No `replace` directives needed—the workspace handles local resolution.
