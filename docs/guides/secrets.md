# Secrets Management

Secrets are managed in **Infisical** and synced to GCP Secret Manager automatically.

## Architecture

```
Infisical (source of truth)
    │
    ├── /backend/secrets → GCP Secret Manager → Cloud Run (file mounts)
    ├── /backend/config  → Terraform reads at deploy → Cloud Run (env vars)
    ├── /frontend        → Build script exports → Vite build
    ├── /ci/deploy       → Terraform authentication (Universal Auth)
    └── /local           → Local dev only (infisical run)
```

## Folder Structure

| Folder | Purpose | How it's used |
|--------|---------|---------------|
| `/backend/secrets` | Sensitive credentials | Synced to Secret Manager, mounted as files at `/etc/secrets/INFISICAL_*/value` |
| `/backend/config` | Application config | Terraform reads at deploy time, passed as environment variables |
| `/frontend` | Web app config | `deploy-web.sh` exports to `.env` files for Vite build |
| `/local` | Local development | Used with `infisical run` or `just setup-secrets` |
| `/ci/deploy` | CI/CD credentials | Terraform authentication (Universal Auth) |

> **`/backend/config` lands in Terraform state** (and `terraform plan` output),
> so keep credentials, tokens, and keys in `/backend/secrets` — never in
> `/backend/config`. When in doubt, prefer `/backend/secrets`.

## Secret Naming Convention

Secrets synced to GCP Secret Manager use the `INFISICAL_` prefix to indicate provenance:

- `INFISICAL_STRAVA_CLIENT_ID` (dispatcher, apigateway)
- `INFISICAL_STRAVA_CLIENT_SECRET` (dispatcher, apigateway)
- `INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN` (dispatcher only)
- `INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID` (dispatcher only)
- `INFISICAL_STRAVA_WEBHOOK_CALLBACK_CAPABILITY` (dispatcher only — **version-pinned**, see [Updating Secrets](#updating-secrets))
- `INFISICAL_AUTH_STATE_SECRET` (apigateway only — HMAC key for OAuth CSRF state tokens)
- `INFISICAL_POSTGRES_CONN_ADMIN`
- `INFISICAL_POSTGRES_CONN_FLYWAY`
- `INFISICAL_POSTGRES_CONN_APIGATEWAY`
- `INFISICAL_POSTGRES_CONN_WRITER`
- `INFISICAL_POSTGRES_CONN_READER`

## Setup

### Prerequisites

1. Install Infisical CLI: `brew install infisical/tap/infisical`
2. Log in: `infisical login`
3. Ensure you have access to the Desirelines project

### Initial Environment Setup

1. **Populate secrets in Infisical**
   - Add all required secrets to `/backend/secrets` folder for your environment (`dev` or `prod`)
   - Add config values to `/backend/config` folder

2. **Configure GCP Secret Manager sync**
   - In Infisical dashboard, set up sync to GCP Secret Manager
   - Target project: `desirelines-dev` or `desirelines-prod`
   - Sync path: `/backend/secrets`

3. **Run Terraform** (from `desirelines-deploy` repo)
   - Terraform creates secret containers with proper IAM bindings
   - Infisical populates the values via sync

### Local Development

```bash
# One-time setup - generates local secret files from Infisical
just setup-secrets

# Or run commands with secrets injected
infisical run --env=local -- your-command
```

## Updating Secrets

1. Update the value in Infisical dashboard
2. Infisical automatically syncs to GCP Secret Manager
3. Redeploy Cloud Run services to pick up new values (merge to main or trigger deploy repo manually)

> **One secret does not work this way.**
> `INFISICAL_STRAVA_WEBHOOK_CALLBACK_CAPABILITY` mounts a **pinned numeric
> Secret Manager version**, not `latest` — `cloud_run.tf:222` selects it from the
> `dispatcher_webhook_callback_capability_secret_version` module input while every
> other secret volume takes `latest`. Publishing a new value in Infisical therefore
> changes *nothing* live, and no amount of redeploying will adopt it until that
> version number is bumped in `desirelines-deploy`.
>
> This is deliberate, not an oversight. The value is embedded in the callback URL
> registered with Strava, so it is one half of a two-system contract. If a mount
> could adopt a new value on its own, an Infisical publish — or merely an instance
> restart — would start rejecting the callbacks Strava is still sending, and every
> webhook would silently stop arriving. Rotation must be coupled to recreating the
> Strava subscription.
>
> Rotating it is a sequenced operation with a deliberate delivery gap, not a
> redeploy: follow
> [`runbooks/webhook-callback-capability.md`](../runbooks/webhook-callback-capability.md).
>
> The general invariant: pin a secret's version only when changing the value
> requires a coordinated update in an external control plane, and automatic
> adoption would break availability or correctness. Verify tokens, subscription
> IDs, client credentials, and database connection strings do not meet that bar
> and stay on `latest`.

## Rotating Secrets

### Strava Credentials

1. Generate new credentials in Strava API settings
2. Update values in Infisical `/backend/secrets`
3. Wait for sync (or trigger manually)
4. Redeploy services

### Webhook Verify Token

1. Update `STRAVA_WEBHOOK_VERIFY_TOKEN` in Infisical
2. Redeploy dispatcher (merge to main or trigger deploy repo)
3. Delete old webhook: `just webhook delete dev`
4. Create new webhook: `just webhook create dev`

### Webhook Callback Capability

**Do not follow the pattern above for this one** — publishing to Infisical and
redeploying will not change the live callback (see [Updating Secrets](#updating-secrets)).

Rotation replaces the URL Strava delivers to, so it requires recreating the
subscription, accepts a short delivery gap, and yields a new subscription ID that
must itself be propagated. The ordering, the force-a-new-revision requirement, and
the rollback path are in
[`runbooks/webhook-callback-capability.md`](../runbooks/webhook-callback-capability.md).

Three things that have actually gone wrong here, worth knowing before you start:

- **Generate with `openssl rand -hex 32`, not `-base64 32`.** Both encode 32 bytes,
  but the wire format must be exactly 64 lowercase hex characters. A base64 value
  fails startup validation and the revision is refused — fail-closed, so it costs
  nothing, but it looks like a formatting nit rather than the real error.
- **Force a new revision after the subscription ID syncs, and confirm the revision
  post-dates the secret version.** A Cloud Run secret volume resolves its version at
  instance start, so a running container keeps validating against the previous
  subscription ID until it recycles. Do not wait on a cache TTL.
- **Never type or paste the callback URL into anything.** Resolve it from Cloud Run.
  A capability sent to the wrong host lands in that host's access logs, plus your
  shell history and process argv, and must then be treated as exposed and rotated.

### PostgreSQL Connection Strings

1. Update connection string in Infisical
2. Wait for sync
3. Redeploy affected services

## Troubleshooting

### Secret not found in Cloud Run

1. Check Infisical sync status in dashboard
2. Verify secret exists: `gcloud secrets list --project=desirelines-dev`
3. Check IAM permissions on the secret

### Local secrets not working

```bash
# Regenerate local secrets
just setup-secrets

# Verify Infisical access
infisical export --env=local --path=/backend/secrets
```

### Terraform can't read config

Ensure Infisical provider credentials are set:

```bash
export INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=...
export INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=...
```

## Related

- [bootstrap.md](./bootstrap.md) - Initial environment setup
- [deployment.md](./deployment.md) - Deployment procedures
