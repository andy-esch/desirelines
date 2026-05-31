# Shared Artifacts Project

Terraform for the **`desirelines-artifacts`** project, which hosts the single
Artifact Registry repo (`desirelines-services`) that all environments pull from.

## Variables

Required inputs have no defaults; copy `terraform.tfvars.example` →
`terraform.tfvars` (gitignored) and fill in. **`ci_deploy_sa_emails` must be
set** — leaving it empty destroys the ci-deploy reader grants and skips the
tag-writer bindings.

## Image retention (cleanup policies)

GCP applies **KEEP before DELETE**: a version matched by any KEEP policy is
retained even if a DELETE policy also matches it. The five policies:

| id | action | matches |
| --- | --- | --- |
| `keep-recent-versions` | KEEP | the 5 most recent versions per image |
| `keep-live-env-images` | KEEP | anything tagged `prod*` / `dev*` (the live images) |
| `delete-old-tagged` | DELETE | tagged versions older than 30d |
| `delete-old-images` | DELETE | untagged versions older than 7d |
| `delete-old-buildcache` | DELETE | `buildcache*` tags older than 14d |

The two KEEP rules are what make `delete-old-tagged` safe: the live `prod`/`dev`
images and the 5 newest are always protected.

### Where `prod` / `dev` tags come from

The image build (`desirelines/.github/workflows/deploy.yml`) only tags
`:latest` + `:<git-sha>`. The stable `prod` / `dev` tags are **stamped at
deploy time** by the `desirelines-deploy` repo's `deploy.yml` (deploy-dev /
deploy-prod jobs), via `gcloud artifacts docker tags add`. `dev` follows every
main merge; `prod` moves only on a release, so it correctly lags `dev` between
releases. The ci-deploy SAs hold the `artifactRegistryTagWriter` custom role
(tag create/update/**delete** — delete is required because moving an existing
tag is a delete+create).

### Rollback-window tradeoff

`delete-old-tagged` trims tagged images older than 30 days that aren't the live
`prod`/`dev` tag or in the recent-5. Consequence: you cannot roll back to an
image older than ~30 days unless it's still the live tag. Accepted for
single-user scope; widen `older_than` or bump `keep_count` if deeper rollback
history is ever needed.

### Activation / dry-run

`cleanup_policy_dry_run` gates whether DELETE policies actually delete. Keep it
`true` while verifying (see below), then flip to `false` to activate.

## Verifying what would be deleted

**Preferred — query the registry directly** (deterministic, no logging setup,
re-runnable). Lists tagged versions older than 30d; anything here that isn't
`prod`/`dev` (and outside the newest 5) is what `delete-old-tagged` would trim.
Empty = nothing to delete.

```bash
REG=us-central1-docker.pkg.dev/desirelines-artifacts/desirelines-services
CUTOFF=$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)        # macOS
# Linux: CUTOFF=$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)
for IMAGE in dispatcher apigateway stravapipe; do
  echo "=== $IMAGE (tagged, >30d) ==="
  gcloud artifacts docker images list "$REG/$IMAGE" --include-tags \
    --project=desirelines-artifacts \
    --filter="createTime<\"$CUTOFF\"" \
    --format="table(version.basename().slice(:16):label=DIGEST, tags.list():label=TAGS, createTime.date('%Y-%m-%d'))" \
    --sort-by=createTime
done
```

Untagged candidates for `delete-old-images` (>7d): same query with a 7-day
cutoff and look for rows with an empty `TAGS` column.

## Audit logs

Tag stamping (`CreateTag` / `DeleteTag`) is in **Admin Activity** logs (always
on, free):

```
logName="projects/desirelines-artifacts/logs/cloudaudit.googleapis.com%2Factivity"
protoPayload.serviceName="artifactregistry.googleapis.com"
protoPayload.methodName=~"CreateTag|DeleteTag"
```

Cleanup-policy version deletions and pushes require **Data Access** logging,
enabled via the `google_project_iam_audit_config` resource here (`DATA_WRITE`
only — `DATA_READ` is intentionally off to avoid logging every image pull):

```
logName="projects/desirelines-artifacts/logs/cloudaudit.googleapis.com%2Fdata_access"
protoPayload.serviceName="artifactregistry.googleapis.com"
protoPayload.methodName=~"DeleteVersion|UploadArtifact"
protoPayload.resourceName=~"repositories/desirelines-services"
```

gcloud equivalent:

```bash
gcloud logging read \
  'protoPayload.serviceName="artifactregistry.googleapis.com"
   AND protoPayload.methodName=~"DeleteVersion|DeleteTag|CreateTag"
   AND protoPayload.resourceName=~"repositories/desirelines-services"' \
  --project=desirelines-artifacts --freshness=2d \
  --format="table(timestamp.date('%Y-%m-%d %H:%M'), protoPayload.methodName, protoPayload.resourceName)"
```

Note: dry-run cleanup does not delete, so it emits no `DeleteVersion` events —
use the direct registry query above to preview dry-run behavior. Data Access
logs capture deletions once cleanup is **active** (`dry_run = false`).
