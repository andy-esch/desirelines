# Deployment Guide

Quick reference for deploying Desirelines services.

## Contents

- [CI/CD (Preferred)](#cicd-preferred)
- [Backend Services](#backend-services) - Cloud Run
- [Web Frontend](#web-frontend) - Firebase Hosting
- [Database Migrations](#database-migrations) - Flyway
- [Strava Webhook](#strava-webhook)
- [Rollback](#rollback)
- [Troubleshooting](#troubleshooting)

---

## Architecture

Deployment uses a **two-repo GitOps model**:

| Repo | Role |
|------|------|
| `desirelines` (this repo, public) | Build Docker images, push to Artifact Registry, trigger deploy |
| `desirelines-deploy` (private) | Terraform config, deployment workflows, state tracking |

Terraform environments (`dev/`, `prod/`) live in the private deploy repo where sensitive values (project numbers, emails) can be committed safely.

---

## CI/CD (Preferred)

| Action | How |
|--------|-----|
| Deploy to dev | Merge PR to main (automatic: build → push → validate → attest → trigger deploy repo) |
| Deploy to prod | `workflow_dispatch` on `desirelines-deploy` → creates PR → review → merge → apply |

### What happens on merge to main

1. `desirelines` compares versioned build inputs since the last successful release and builds changed
   images from the full source commit SHA, then pushes to Artifact Registry.
2. Each build's OCI index digest must match its full-SHA registry tag. GitHub signs
   provenance for that exact image name and digest; validation or signing failure
   prevents deployment dispatch.
3. `trigger-deploy` sends the full SHA to `desirelines-deploy`. A successful
   comparison with no changed images still dispatches a configuration-only candidate.
4. The deploy repo selects image digests, runs Flyway on normal tagged deploys and
   auxiliary retry/forced redeploys, applies Terraform for dev, and updates its ledger.
5. Web frontend is built and deployed to Firebase Hosting.

See [ci.md](./ci.md) for workflow details.

#### Why deploys reference image digests

Cloud Run services are deployed by digest (`image@sha256:…`). The images are
tagged with the git SHA, so a tag-based reference **changes on every commit** — Terraform
diffs the string and rolls a new revision for *every* service on *every* push, including
services whose code did not change. Each of those is a real traffic-shifting rollout, so an
unchanged service carried full rollout risk for nothing.

Referencing the digest makes Terraform's own diff the guard: identical bytes produce an
identical reference, so there is no diff and no revision.

Both dev and prod commit per-service digests in `images.auto.tfvars`. Production's
promotion PR exposes those digests for review. `deployment_version` records the
desired application commit for observability and migration source selection; it
does not prove that an image was built from that commit. The module also supports
tag references when no digest is supplied, for bootstrap use.

The producer uses `docker/build-push-action`'s pushed digest output, checks it via
`gcloud artifacts docker images describe … --format='value(image_summary.digest)'`,
and signs that same digest. The deploy repo resolves candidate tags separately and
can retain a declared digest for a service that was not rebuilt. Consumer-side
signature and source-equivalence enforcement is a separate rollout step; the
existing resolver does not yet prove that a carried-forward image is unchanged.

### Signed release image provenance

`scripts/ci/image-build-inputs.json` is the versioned input catalog. Whole service
trees are compared conservatively; shared Go changes rebuild both Go services.
The build workflow, release tooling/catalog, optional root `.dockerignore` and
Git attribute/submodule rules rebuild every image when changed. The Python README
and committed generated files are covered. Unrelated frontend, root docs, schema-source and Terraform changes
do not rebuild images; generated consumer files must be committed after schema changes.

The comparison starts at the latest successful main push of `deploy.yml`, not
the preceding push's commit. A failed build or a replaced queued run therefore
keeps its service changes in the next selection, even if that next push only
changes docs. No successful history means all services build; unavailable or
malformed history, missing Git commits and diff errors stop selection and dispatch.
The changes job uses a read-only Actions token to query this checkpoint. It
records producer completion, not a successful deployment or authenticated image
provenance; consumer verification is still required.

BuildKit reads an immutable Git context at the full SHA, with the Python context
restricted to its package. Checkout mutations and local uncommitted files are not
part of a hosted release build. The GitHub attestation binds the fully qualified
image name and pushed OCI **index** digest to the source commit and
`.github/workflows/deploy.yml` identity. A platform-specific child digest is a
different subject. Full-SHA tags identify builds but remain mutable registry tags.

Signed evidence is stored in GitHub's attestation API, independently of expiring
build-record artifacts. This stage does not push attestation bundles to the registry
or backfill signatures for old images. See the [GitHub attestation action](https://github.com/actions/attest)
and [Buildx Git context documentation](https://github.com/docker/build-push-action#git-context).

Before enabling deployment enforcement, merge this producer, verify a successful
main build attests all three services, and promote an attested baseline through dev
and prod using the normal deployment process. Later enforcement must authenticate
the builder/source and compare build inputs to the desired candidate before
Flyway; it must preserve reviewed production digests. A signature alone is not
that full deployment policy.

---

## Backend Services

### Deploy via CI (Recommended)

Merge to main triggers automatic dev deployment. No manual terraform needed.

### Manual recovery

Use the deploy repo's retry or forced-redeploy workflows for backend recovery.
They require Flyway success for the selected candidate before Terraform apply.
Local Terraform apply does not automatically run this gate; follow the deploy
repo's recovery instructions and migration prerequisites before any local apply.

### Verify Deployment

```bash
gcloud run services list --region=us-central1
gcloud run services logs read desirelines-dispatcher --region=us-central1 --limit=20
```

---

## Web Frontend

Deploys to Firebase Hosting. Now handled by `deploy-web.yml` in the deploy repo (runs after backend deploy).

### Local Deploy

Configuration is managed by **Infisical**. Ensure you have the Infisical CLI installed and are logged in (`infisical login`).

```bash
# Dev/staging
just deploy-web dev

# Production
just deploy-web prod
```

---

## Database Migrations

PostgreSQL migrations managed by Flyway.

```bash
just db-migrate dev info  # Check status
just db-migrate dev       # Run migrations
```

See [Database Migrations](../../schemas/database/README.md) for details and the
[activity-ID allocation rollout checks](../../schemas/database/README.md#activity-id-allocation-rollout)
(before V0015) and [compatibility/final cleanup rollout](../../schemas/database/README.md#activity-id-cleanup-rollout).
V0015 requires the compatibility writer/backfill images to be serving and old
executions drained before migration; older writer rollbacks become incompatible.

---

## Strava Webhook

```bash
just webhook view dev      # View current subscription
just webhook create dev    # Create subscription
```

See [strava-webhook.md](./strava-webhook.md) for OAuth2 setup.

---

## Rollback

Find a previous image version:

```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/desirelines-artifacts/desirelines-services/dispatcher \
  --sort-by=~CREATE_TIME --limit=5
```

Restore a coherent application commit and per-service digest map through the
deploy repo's reviewed deployment/recovery flow. Changing `deployment_version`
alone leaves committed digests pointing to the current images. Confirm schema
compatibility first: older writer images are incompatible after V0015 cleanup.
`just build-publish` makes local, unsigned images; use the hosted release workflow
to produce signed release evidence.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `denied: Permission denied` | `gcloud auth configure-docker us-central1-docker.pkg.dev` |
| `.env.*.local not found` | Create env file per `packages/web/README.md` |
| Webhook not receiving events | Check OAuth2 - see [strava-webhook.md](./strava-webhook.md) |
| `ModuleNotFoundError` | Fix the committed build inputs and merge to main for a new signed release build |

### Check Service Health

```bash
gcloud run services describe desirelines-dispatcher \
  --region=us-central1 --format='value(status.conditions)'

gcloud run services logs read desirelines-dispatcher \
  --region=us-central1 --filter='severity>=ERROR' --limit=20
```

---

## Related

- [bootstrap.md](./bootstrap.md) - Initial environment setup
- [strava-webhook.md](./strava-webhook.md) - Webhook configuration
- [ci.md](./ci.md) - CI/CD pipeline
- [terraform/README.md](../../terraform/README.md) - Terraform modules
