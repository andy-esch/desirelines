# ==============================================================================
# Storage Buckets
# ==============================================================================
# All Cloud Functions have been migrated to Cloud Run services (see cloud_run.tf).
# This file now only contains storage bucket resources.

# Locals for function source configuration
locals {
  # Function source bucket (local or external) - kept for historical packages
  function_source_bucket = var.external_function_source_bucket != null ? var.external_function_source_bucket : google_storage_bucket.function_source[0].name
}

# ==============================================================================
# Function Source Bucket (Historical)
# ==============================================================================

# Cloud Storage Bucket for function source packages (only created if not using external bucket)
# NOTE: This bucket contains historical Cloud Function packages. New deployments use
# Docker images in Artifact Registry. Kept for reference and potential rollback.
resource "google_storage_bucket" "function_source" {
  count = var.external_function_source_bucket == null ? 1 : 0

  name          = "${var.gcp_project_id}-function-source"
  location      = var.storage_location
  force_destroy = var.environment != "prod"

  labels = local.common_labels

  # Uniform bucket-level access (no ACLs)
  uniform_bucket_level_access = true

  # Lifecycle rules for source package cleanup
  lifecycle_rule {
    condition {
      age = 30 # Keep source packages for 30 days
    }
    action {
      type = "Delete"
    }
  }
}

# ==============================================================================
# Aggregation Bucket (ORPHANED - Data Preserved)
# ==============================================================================

# Cloud Storage Bucket for aggregated data (ORPHANED)
# DEPRECATED 2025-12-18: This bucket is no longer written to after PostgreSQL migration.
# The bucket and its contents are preserved for historical reference.
# API Gateway now reads directly from PostgreSQL instead of these JSON blobs.
resource "google_storage_bucket" "aggregation_bucket" {
  name          = local.bucket_name
  location      = var.storage_location
  force_destroy = false # Never force destroy - data preserved

  labels = local.common_labels

  # Uniform bucket-level access (no ACLs)
  uniform_bucket_level_access = true

  # Versioning for data protection
  versioning {
    enabled = var.environment == "prod"
  }

  # Lifecycle rules for cost optimization
  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
    }
  }

  # Version cleanup: Keep last 10 versions OR 7 days, whichever comes first
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 7
      num_newer_versions         = 10
    }
    action {
      type = "Delete"
    }
  }

  # IMPORTANT: Prevent Terraform from deleting this bucket
  # This orphans the bucket when removed from Terraform state
  lifecycle {
    prevent_destroy = true
  }
}
