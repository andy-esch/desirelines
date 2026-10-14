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
| `desirelines` (this repo, public) | Build and push Docker images, validate digests, sign provenance, trigger deploy |
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
4. The deploy repo verifies selected image provenance and source-input equivalence
   before Flyway, then applies Terraform for dev and updates its ledger. Direct dev
   configuration pushes verify the committed map and run Flyway too.
5. Web frontend is built and deployed to Firebase Hosting.

See [ci.md](./ci.md) for workflow details.

#### Why deploys reference image digests

Cloud Run services are deployed by digest (`image@sha256:…`). The images are
tagged with the git SHA, so a tag-based reference **changes on every commit** — Terraform
diffs the string and rolls a new revision for *every* service on *every* push, including
services whose code did not change. Each of those is a real traffic-shifting rollout, so an
unchanged service carried full rollout risk for nothing.

Keeping an unchanged service's digest makes Terraform's own diff the guard: the
reference stays identical, so there is no image diff and no new revision.
Rebuilding can change the parent index's metadata even when the runtime image
bytes are identical; equal platform images do not imply equal index digests.

Both dev and prod commit per-service digests in `images.auto.tfvars`. Production's
promotion PR exposes those digests for review. `deployment_version` records the
desired application commit for observability and migration source selection; it
does not prove that an image was built from that commit. The module also supports
tag references when no digest is supplied, for bootstrap use.

The producer uses `docker/build-push-action`'s pushed digest output, checks it via
`gcloud artifacts docker images describe … --format='value(image_summary.digest)'`,
and signs that same digest. The deploy repo resolves full-SHA candidate tags
separately. A successful empty lookup can retain a declared index only after
signed evidence and source-input comparison prove the service was unchanged.
Registry errors stop deployment. Production verifies the reviewed committed
indexes without resolving replacement tags.

### Signed release image provenance

`scripts/ci/image-build-inputs.json` is the versioned input catalog. Whole service
trees are compared conservatively; shared Go changes rebuild both Go services.
The build workflow, release tooling/catalog, optional root `.dockerignore` and
Git attribute rules and `.gitmodules` metadata rebuild every image when changed. The Python README
and committed generated files are covered. Unrelated frontend, root docs, schema-source and Terraform changes
do not rebuild images; generated consumer files must be committed after schema changes.

The comparison starts at the latest successful main push of `deploy.yml`, not
the preceding push's commit. A failed build or a replaced queued run therefore
keeps its service changes in the next selection, even if that next push only
changes docs. No successful history means all services build; unavailable or
malformed history, missing Git commits and diff errors stop selection and dispatch.
The changes job uses a read-only Actions token to query this checkpoint. It
records producer completion, not a successful deployment or authenticated image
provenance; the deployment verifier authenticates each selected image separately.

BuildKit reads an immutable Git context at the full SHA, with the Python context
restricted to its package. Checkout mutations and local uncommitted files are not
part of a hosted release build. The GitHub attestation binds the fully qualified
image name and pushed OCI **index** digest to the source commit and
`.github/workflows/deploy.yml` identity. A platform-specific child digest is a
different subject. Full-SHA tags identify builds but remain mutable registry tags.

Signed evidence is stored in GitHub's attestation API, independently of expiring
build-record artifacts. The producer does not push attestation bundles to the registry
or backfill signatures for old images. See the [GitHub attestation action](https://github.com/actions/attest)
and [Buildx Git context documentation](https://github.com/docker/build-push-action#git-context).

The deployment verifier enforces this policy before Flyway on normal dev
(including direct configuration pushes), production plan/apply, retry and forced
redeploy. It authenticates the exact index subject and hosted main workflow,
repository identity and full build source from GitHub's verified signing
certificate. The build source must be an ancestor of the desired main-lineage
candidate. Raw Git tree entries for cataloged common/service inputs must match;
changed inputs and catalog/workflow changes require a signed rebuild. Missing
history or invalid evidence blocks verification until resolved. Relative symlinks
must point to direct tracked paths covered by the catalog, with parent traversal
only at the start. Absolute/dangling links and linked ancestors are unsupported;
gitlink build inputs fail closed because version 1 does not inspect submodule link
topology. The producer enforces the same guards before selecting builds. Candidate
Git code is read as objects, never executed.

Short and full candidate SHAs resolve to one full commit used by verification,
Flyway and Terraform. A present dev candidate tag must name a signed build at
that commit; an older declared index requires proven input equivalence. Prod
retry defaults to the declared production candidate and preserves its reviewed
map; an explicit different release requires a promotion PR. The gate emits a
per-run report with selected indexes and authenticated build sources, then
reauthenticates GitHub evidence on every run, including apply after PR review.
It does not rely on expiring producer artifacts or a deployment ledger.

The signed baseline has been verified in dev and prod. A verified signature and
input match do not establish schema compatibility, application health or
hermetic builds. Continue the live readiness/retention checks below. Unsigned
manual images and tag-only bootstrap configurations cannot pass the hosted gate.

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

Review the environment's committed `images.auto.tfvars`, desired
`deployment_version`, successful deployment run and `.deployed/<env>.json`
together. The ledger is the latest recorded result; check its status and the live
resources rather than treating its version alone as proof of success.

For each of `dispatcher`, `apigateway` and `stravapipe`, verify the **committed
parent index**, with the full source SHA from its hosted build. Authenticate
`gh` and configure Docker's registry credential helper first (see
[troubleshooting](#troubleshooting)). Replace the two placeholders below:

```bash
IMAGE=us-central1-docker.pkg.dev/desirelines-artifacts/desirelines-services/stravapipe
INDEX_DIGEST='sha256:REVIEWED_INDEX_DIGEST'
BUILD_SOURCE='FULL_40_CHARACTER_BUILD_SOURCE_SHA'

gh attestation verify "oci://$IMAGE@$INDEX_DIGEST" \
  --repo andy-esch/desirelines \
  --cert-identity https://github.com/andy-esch/desirelines/.github/workflows/deploy.yml@refs/heads/main \
  --cert-oidc-issuer https://token.actions.githubusercontent.com \
  --source-ref refs/heads/main \
  --source-digest "$BUILD_SOURCE" --signer-digest "$BUILD_SOURCE" \
  --deny-self-hosted-runners --predicate-type https://slsa.dev/provenance/v1

docker buildx imagetools inspect --raw "$IMAGE@$INDEX_DIGEST"
```

A carried-forward image can have an older build source than the desired
candidate. Compare both `common_inputs` and the service's `inputs` in
`scripts/ci/image-build-inputs.json` between those full commits, including the
catalog and release-policy files themselves. A service-directory-only diff is
insufficient. Successful signature verification or a failed candidate-tag lookup
does not perform this comparison. Inspect the raw index's `linux/amd64` child
digest for the live revision check below. An unsigned index can share that same child with
a signed index, so verifying the child or a different parent is insufficient.

```bash
PROJECT=desirelines-prod # or desirelines-dev
SERVICE=desirelines-postgres-writer

gcloud run services describe "$SERVICE" --project="$PROJECT" --region=us-central1 \
  --format='yaml(spec.template.spec.containers[0].image,status.latestCreatedRevisionName,status.latestReadyRevisionName,status.traffic,status.conditions)'
REVISION=$(gcloud run services describe "$SERVICE" --project="$PROJECT" \
  --region=us-central1 --format='value(status.latestReadyRevisionName)')
gcloud run revisions describe "$REVISION" --project="$PROJECT" --region=us-central1 \
  --format='value(status.imageDigest)'
```

The service template must reference the reviewed parent index; Cloud Run's
revision digest can resolve to its platform child. Check that latest-created
equals latest-ready, readiness is true, and the expected revision receives
100% traffic. Repeat for API gateway, dispatcher, writer and deletion services;
writer and deletion use `stravapipe`. Check the backfill job's configured
`stravapipe` index and readiness too:

```bash
gcloud run jobs describe desirelines-backfill --project="$PROJECT" --region=us-central1 \
  --format='yaml(spec.template.spec.template.spec.containers[0].image,status.conditions)'
```

Normal tagged dev deployments and prod applies attempt to move the stable
`dev`/`prod` tags to the selected digests for retention. Stamping failures are
warnings and do not fail the deployment; retry, forced redeploy and dev
configuration-only applies currently skip stamping. Check the registry tags
against the deployed map after recovery rather than assuming a successful run
protected the images. These mutable tags do not authenticate a source commit.
Inspect service logs and perform the release's application checks separately
from provenance/readiness checks.

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
