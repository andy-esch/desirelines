# shared

Shared Go packages for the desirelines monorepo.

## Packages

| Package | Description |
|---------|-------------|
| [gcplog](./gcplog/) | Structured logging for GCP Cloud Logging integration |

## Usage

These packages are available to other modules in the monorepo via `go.work`. Import them directly:

```go
import "github.com/andy-esch/desirelines/packages/shared/gcplog"
```

No `replace` directives needed—the workspace handles local resolution.
