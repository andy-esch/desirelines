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
| Deploy to dev | Merge PR to main (automatic: build → push → trigger deploy repo) |
| Deploy to prod | `workflow_dispatch` on `desirelines-deploy` → creates PR → review → merge → apply |

### What happens on merge to main

1. `desirelines` CI builds Docker images and pushes to Artifact Registry
2. `trigger-deploy` job sends `repository_dispatch` to `desirelines-deploy`
3. Deploy repo resolves each image tag to its **immutable digest**, then auto-applies
   terraform for dev and updates `.deployed/dev.json`
4. Web frontend is built and deployed to Firebase Hosting

See [ci.md](./ci.md) for workflow details.

#### Why deploys reference image digests

Cloud Run services are deployed by digest (`image@sha256:…`), not by tag. The images are
tagged with the git SHA, so a tag-based reference **changes on every commit** — Terraform
diffs the string and rolls a new revision for *every* service on *every* push, including
services whose code did not change. Each of those is a real traffic-shifting rollout, so an
unchanged service carried full rollout risk for nothing.

Referencing the digest makes Terraform's own diff the guard: identical bytes produce an
identical reference, so there is no diff and no revision.

Two details worth knowing:

- **This is about deploy churn, not supply-chain immutability.** Cloud Run already resolves
  a tag to a digest and pins each revision to it, so the running bytes were always fixed.
  What was not fixed was Terraform's view of them.
- **Digests are resolved from the registry**, via
  `gcloud artifacts docker images describe … --format='value(image_summary.digest)'` — not
  from `docker/build-push-action`'s `digest` output, which is unreliable under buildx with
  GitHub Actions caching.

`deployment_version` is unchanged and still carries the git SHA: it is the provenance record
and is still used for Cloud Function source packages.

**dev and prod differ here, deliberately.** dev passes digests per-apply via `-var` (its
tfvars is a record written *after* a successful apply). Prod's tfvars *is* the reviewed
deployment request — `create-prod-pr` writes it, `plan-prod` plans it, and the merge applies
exactly that — so prod will carry digests **in tfvars** rather than as an apply-time
override. Prod is a separate, later change; today it still deploys by tag.

---

## Backend Services

### Deploy via CI (Recommended)

Merge to main triggers automatic dev deployment. No manual terraform needed.

### Manual Deploy (from deploy repo)

For manual control, work from a cloned `desirelines-deploy`:

```bash
cd desirelines-deploy/environments/dev
infisical run --env=dev --path=/ci/deploy -- terraform plan
infisical run --env=dev --path=/ci/deploy -- terraform apply
```

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

See `schemas/database/README.md` for details.

---

## Strava Webhook

```bash
just webhook view dev      # View current subscription
just webhook create dev    # Create subscription
```

See [strava-webhook.md](./strava-webhook.md) for OAuth2 setup.

---

## Rollback

```bash
# Find previous version
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/desirelines-artifacts/desirelines-services/dispatcher \
  --sort-by=~CREATE_TIME --limit=5

# Deploy previous version via deploy repo:
# Update deployment_version in desirelines-deploy/environments/dev/terraform.tfvars
# Then terraform apply (or trigger via workflow_dispatch)
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `denied: Permission denied` | `gcloud auth configure-docker us-central1-docker.pkg.dev` |
| `.env.*.local not found` | Create env file per `packages/web/README.md` |
| Webhook not receiving events | Check OAuth2 - see [strava-webhook.md](./strava-webhook.md) |
| `ModuleNotFoundError` | Rebuild: `just build-publish` then deploy via CI |

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
