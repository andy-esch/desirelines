# Shared Artifacts Project
# This project hosts the Artifact Registry used by all environments (dev, prod)

terraform {
  required_version = ">= 1.12"

  # Configure backend with: terraform init -backend-config=backend.tfvars
  backend "gcs" {
    prefix = "terraform/state"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.22"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# Artifact Registry for Docker images
resource "google_artifact_registry_repository" "services" {
  location      = var.gcp_region
  repository_id = "desirelines-services"
  description   = "Container registry for desirelines Cloud Run services (shared across all environments)"
  format        = "DOCKER"

  # Cleanup policies: manage image and build cache retention.
  #
  # KEEP precedence (per GCP docs): "If an artifact version matches criteria in
  # both a delete policy and a keep policy, Artifact Registry applies the keep
  # policy." Semantic, not declaration-order dependent. The two KEEP rules
  # (recent-5 + live-env tags) protect the live prod/dev images and the newest
  # builds from the tagged-DELETE.
  #
  # Cleanup is ACTIVE (dry_run = false): it trims tagged images older than 30d
  # that are neither the live prod/dev tag nor in the recent-5. The live prod/dev
  # tags are stamped at deploy time (see README.md → "Where prod/dev tags come
  # from"); if stamping ever lapses, the live image loses protection. To preview
  # what would be removed before a policy change, run the registry query in
  # README.md ("Verifying what would be deleted") or temporarily set dry_run.
  cleanup_policy_dry_run = false

  # Keep last 5 tagged versions of each service image
  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  # Always retain the image each environment is currently running, regardless
  # of age. tag_prefixes requires tag_state = TAGGED; "prod"/"dev" can't collide
  # with a git-SHA tag (SHAs are hex).
  #
  # TAG SOURCE — these stable tags are NOT emitted by the image build. The build
  # job in desirelines/.github/workflows/deploy.yml tags each image only
  # `:latest` + `:<git-sha>` (build-images job, "tags:" ~L82-84). The `prod` /
  # `dev` tags are stamped at deploy time by the desirelines-deploy repo's
  # .github/workflows/deploy.yml (deploy-dev / deploy-prod jobs): `dev` follows
  # every main merge, `prod` moves on release. If stamping ever lapses this KEEP
  # stops protecting the live image — the stamp step warns loudly on failure.
  cleanup_policies {
    id     = "keep-live-env-images"
    action = "KEEP"
    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["prod", "dev"]
    }
  }

  # Trim accumulated tagged images for cost. Safe because the two KEEP policies
  # above protect the recent-5 and the live prod/dev images from this rule.
  cleanup_policies {
    id     = "delete-old-tagged"
    action = "DELETE"
    condition {
      tag_state  = "TAGGED"
      older_than = "2592000s" # 30 days
    }
  }

  # Delete untagged image manifests older than 7 days
  cleanup_policies {
    id     = "delete-old-images"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s" # 7 days
    }
  }

  # Delete build cache manifests older than 14 days
  # Registry-based layer cache (buildcache tags) from docker/build-push-action
  cleanup_policies {
    id     = "delete-old-buildcache"
    action = "DELETE"
    condition {
      tag_prefixes = ["buildcache"]
      older_than   = "1209600s" # 14 days
    }
  }

  labels = {
    project    = "desirelines"
    managed_by = "terraform"
    purpose    = "shared-artifacts"
  }
}

# ==============================================================================
# IAM: Allow dev project to pull images
# ==============================================================================
resource "google_artifact_registry_repository_iam_member" "dev_pull" {
  project    = var.gcp_project_id
  location   = var.gcp_region
  repository = google_artifact_registry_repository.services.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${var.dev_project_number}@serverless-robot-prod.iam.gserviceaccount.com"
}

# ==============================================================================
# IAM: Allow prod project to pull images
# ==============================================================================
resource "google_artifact_registry_repository_iam_member" "prod_pull" {
  project    = var.gcp_project_id
  location   = var.gcp_region
  repository = google_artifact_registry_repository.services.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${var.prod_project_number}@serverless-robot-prod.iam.gserviceaccount.com"
}

# ==============================================================================
# IAM: Allow GitHub Actions to push images
# ==============================================================================
# This uses Workload Identity Federation from the dev project
# The GitHub Actions workflow authenticates via WIF and needs writer access
resource "google_artifact_registry_repository_iam_member" "github_actions_push" {
  project    = var.gcp_project_id
  location   = var.gcp_region
  repository = google_artifact_registry_repository.services.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${var.github_actions_sa_email}"
}

# ==============================================================================
# IAM: Allow ci-deploy SAs to pull images (for Terraform state refresh)
# ==============================================================================
resource "google_artifact_registry_repository_iam_member" "ci_deploy_pull" {
  for_each   = toset(var.ci_deploy_sa_emails)
  project    = var.gcp_project_id
  location   = var.gcp_region
  repository = google_artifact_registry_repository.services.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${each.value}"
}

# ==============================================================================
# IAM: Allow ci-deploy SAs to stamp the stable `prod` / `dev` env tags
# ==============================================================================
# The deploy repo's deploy.yml (deploy-dev / deploy-prod jobs, "Stamp stable
# env tag" steps) runs `gcloud artifacts docker tags add` to move the prod/dev
# tags onto the freshly-deployed image. That needs tag-write, which reader does
# not grant. Rather than the broad `roles/artifactregistry.writer` (push +
# delete versions — flagged as over-broad for ci-deploy in the 2026-03-17
# terraform audit), grant a minimal custom role with only tag-mutation
# permissions, scoped to this single repo. Reads (resolving the source digest)
# are already covered by ci_deploy_pull above.
#
# tags.delete is required: re-pointing an existing tag (the steady-state case,
# once prod/dev already exist) is a delete+create, not an update — confirmed at
# runtime by a PERMISSION_DENIED on tags.delete. Still tag-only: no
# versions.delete, so images themselves can't be removed by this role.
resource "google_project_iam_custom_role" "tag_writer" {
  project     = var.gcp_project_id
  role_id     = "artifactRegistryTagWriter"
  title       = "Artifact Registry Tag Writer"
  description = "Create/update/delete tags only (move stable prod/dev env tags); no image push or version delete."
  permissions = [
    "artifactregistry.tags.create",
    "artifactregistry.tags.update",
    "artifactregistry.tags.delete",
  ]
}

resource "google_artifact_registry_repository_iam_member" "ci_deploy_tag_writer" {
  for_each   = toset(var.ci_deploy_sa_emails)
  project    = var.gcp_project_id
  location   = var.gcp_region
  repository = google_artifact_registry_repository.services.name
  role       = google_project_iam_custom_role.tag_writer.id
  member     = "serviceAccount:${each.value}"
}

# ==============================================================================
# Audit logging: capture Artifact Registry write/delete activity
# ==============================================================================
# Surfaces cleanup-policy version deletions (and pushes/tag moves) in Cloud
# Logging so the retention policy has an auditable trail — see README.md for the
# Logs Explorer / gcloud queries.
#
# DATA_WRITE only, deliberately:
#   - DATA_WRITE = pushes, tag create/delete, version deletions (cleanup). Low
#     volume, worth keeping.
#   - DATA_READ is OMITTED: it logs every image pull (every Cloud Run cold start
#     and deploy) — high volume, real cost, little value for a single-user repo.
#   - Tag-stamping CreateTag/DeleteTag already land in Admin Activity logs
#     (always on, free); this only adds the write/delete data-plane trail.
# This project is dedicated to the registry, so a project-level config is
# effectively scoped to Artifact Registry.
resource "google_project_iam_audit_config" "artifact_registry" {
  project = var.gcp_project_id
  service = "artifactregistry.googleapis.com"

  audit_log_config {
    log_type = "DATA_WRITE"
  }
}
