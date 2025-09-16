# Bootstrap configuration for Terraform remote state storage
# Run this once to create the state bucket before using remote backends

terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# Configure the Google Cloud Provider
provider "google" {
  project = var.gcp_project_id
  region  = "us-central1"
}

# Create bucket for storing Terraform state
resource "google_storage_bucket" "terraform_state" {
  name          = "${var.gcp_project_id}-terraform-state"
  location      = "US"
  force_destroy = false

  # Enable versioning for state file protection
  versioning {
    enabled = true
  }

  # Uniform bucket-level access
  uniform_bucket_level_access = true

  # Lifecycle management
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  # Labels
  labels = {
    purpose    = "terraform-state"
    managed_by = "terraform"
    project    = "desirelines"
  }
}

# Versioning is already enabled in the bucket resource above

variable "gcp_project_id" {
  description = "Google Cloud Project ID"
  type        = string
}
