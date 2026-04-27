# 05. Configuration & Startup Invariants

> **Goal:** Centralize environment detection, validate configuration at build/boot time, and make misconfiguration impossible to deploy. Small refactor, lasting payoff.

## Why it matters

Configuration is currently *correct but scattered*. Logic to detect "production vs. local dev" lives in three different files; the embedded sport config is loaded lazily and only validated on first use; the mock athlete ID for local dev is a magic number that silently mismatches your seed data. Each is a paper cut. Together they account for the "I deployed and it didn't work and I can't tell why" debugging sessions.

The fix is mechanical and the diff is small.

## Current state

- `config/config.go:65–68` — `Environment` is a string. Comparisons are `cfg.Environment == "production"` scattered across files.
- `cmd/apigateway/main.go:236–247` — branching on environment to pick Firebase real vs. emulator, real Strava vs. mock.
- `internal/auth/handler.go` — separate environment check to enforce HTTPS-only callback URLs in prod.
- `config/sport_config.go:32–33` — `//go:embed sport_types.json`. Loaded via `sync.Once` on first use; version validation happens then.
- `config/sport_config.go:136–141` — version check returns an error at runtime. Startup succeeds even if config is unsupported; first request fails.
- `cmd/apigateway/main.go:438–446` — `MOCK_ATHLETE_ID` defaults to `123456789`. No warning if the value doesn't match any seeded activity.
- No JSON-schema validation for `sport_types.json` at build time.
- Cloud Run / Terraform sets env vars; misnamed vars (e.g., `FRONTEND_URLS` vs. `FRONTEND_URL`) silently fall back to defaults in some places.

## Concrete steps

### 1. Introduce a typed `Environment` enum

In `config/config.go`:

```go
type Environment string

const (
    EnvLocal      Environment = "local"
    EnvStaging    Environment = "staging"
    EnvProduction Environment = "production"
)

func (e Environment) IsLocal() bool      { return e == EnvLocal }
func (e Environment) IsProduction() bool { return e == EnvProduction }

func parseEnvironment(s string) (Environment, error) {
    switch Environment(s) {
    case EnvLocal, EnvStaging, EnvProduction:
        return Environment(s), nil
    default:
        return "", fmt.Errorf("invalid ENVIRONMENT: %q (must be local|staging|production)", s)
    }
}
```

Replace every `cfg.Environment == "production"` with `cfg.Environment.IsProduction()`. Compiler catches typos. Adding a new environment is a one-line constant change.

### 2. Centralize all environment-conditional construction

Today auth-handler construction has different paths in local vs. prod (`main.go:236–247`). Extract a single function:

```go
func buildAuthDeps(ctx context.Context, cfg *config.Config) (*authpkg.Deps, error) {
    switch cfg.Environment {
    case config.EnvLocal:
        return buildLocalAuthDeps(ctx, cfg)
    default:
        return buildProductionAuthDeps(ctx, cfg)
    }
}
```

Now there's exactly one place to ask "what does local mean?" instead of three.

### 3. Validate sport config at startup, not first request

In `cmd/apigateway/main.go`, after config load, call `config.LoadSportConfig()` explicitly and propagate the error. Failure → process exits before binding to a port. Cloud Run sees the failed startup probe and rolls back.

```go
if _, err := config.LoadSportConfig(); err != nil {
    return fmt.Errorf("sport config invalid at startup: %w", err)
}
```

Also: replace `sync.Once` lazy loading with eager loading at startup, since the file is embedded and parsing is cheap. Removes a class of "first request after deploy is slow" surprises.

### 4. Validate `sport_types.json` at build time

Write a small `cmd/validate-sport-config/main.go`:

```go
//go:build tools

func main() {
    cfg, err := config.LoadSportConfig()
    if err != nil { os.Exit(1) }
    // assert version, expected sports, no orphan categories
    fmt.Println("OK")
}
```

Add `//go:generate go run ./cmd/validate-sport-config` to `config/sport_config.go`. Run `go generate ./...` in CI before tests. Now a malformed config breaks the build, not the deployment.

Stretch: add a JSON Schema (`schemas/sport_types.schema.json`) and validate against it. Lets stravapipe and apigateway share validation logic.

### 5. Sanity-check `MOCK_ATHLETE_ID` against the seed database

In `main.go`, when `Environment == EnvLocal`, after pool init:

```go
if cfg.MockAthleteID != "" {
    var count int
    if err := pool.QueryRow(ctx,
        "SELECT count(*) FROM activities WHERE user_id = $1",
        cfg.MockAthleteID,
    ).Scan(&count); err == nil && count == 0 {
        logger.Warn("MOCK_ATHLETE_ID has no activities in database",
            "mock_athlete_id", cfg.MockAthleteID,
            "hint", "run scripts/seed-local-data.sh or set MOCK_ATHLETE_ID to match seed data")
    }
}
```

Doesn't fail boot — local dev sometimes legitimately starts empty — but tells you why the dashboard is blank.

### 6. Make CORS configuration mandatory in non-local environments

`pkg/cors/cors.go:15–20` — currently logs a warning when `ALLOWED_ORIGINS` is empty. Change to:

```go
if cfg.Environment != config.EnvLocal && len(cfg.AllowedOrigins) == 0 {
    return nil, fmt.Errorf("ALLOWED_ORIGINS required in %s environment", cfg.Environment)
}
```

A staging deployment with missing CORS now fails to start, instead of silently CORS-rejecting every request.

### 7. Single source of truth for required env vars

Add a `config.Required()` method that returns the list of required env vars per environment. CI runs a script that:

1. Reads `terraform/modules/apigateway/variables.tf`.
2. Reads `config.Required(EnvProduction)`.
3. Asserts every required var is wired in Terraform.

Two-way drift (Go expects var that Terraform doesn't set, or vice versa) gets caught at PR time.

### 8. Add `config.String()` with secrets redacted

For startup logging — and only for startup logging — implement:

```go
func (c *Config) String() string {
    return fmt.Sprintf("Config{environment=%s, frontend_url=%s, postgres=<redacted>, ...}", ...)
}
```

Log the redacted struct on boot. When debugging "did the right env vars actually get set?" you can read the answer in Cloud Logging without grepping a deployment manifest. Never include the connection string or secret values.

## What to skip

- **Don't** introduce a config-management library (Viper, Koanf). Plain env-var parsing with explicit validation is the right level.
- **Don't** support YAML/TOML config files. Cloud Run is env-var-native; adding files is a step backward.
- **Don't** dynamically reload config. Deploy a new revision instead.

## References

- The Twelve-Factor App, "Config" (the canonical reference): https://12factor.net/config
- Go embed package: https://pkg.go.dev/embed
- Go generate and `//go:generate` directives: https://go.dev/blog/generate
- Cloud Run startup and liveness probes: https://cloud.google.com/run/docs/configuring/healthchecks
- "Parse, don't validate" (Alexis King) — applies directly to typed `Environment`: https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
- JSON Schema: https://json-schema.org/
- Stripe's "Designing robust and predictable APIs" (mentions config invariants briefly): https://stripe.com/blog/idempotency
