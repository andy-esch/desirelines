# Local development environment configuration

terraform {
  required_version = ">= 1.0"

  # State will be stored locally for development
  # backend "gcs" {
  #   bucket = "desirelines-terraform-state"
  #   prefix = "environments/local"
  # }

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
  region  = var.gcp_region
}

# Use the desirelines module
module "desirelines" {
  source = "../../modules/desirelines"

  # Environment-specific configuration
  project_name   = "desirelines"
  environment    = "local"
  gcp_project_id = var.gcp_project_id
  gcp_region     = var.gcp_region

  # Local development uses relaxed settings
  bigquery_location = "US"
  storage_location  = "US"

  # Use terraform service account for local dev dataset access
  service_account_email = "terraform-desirelines@progressor-341702.iam.gserviceaccount.com"

  # Optional: Add developer email for BigQuery console access
  developer_email = var.developer_email

  # Enable APIs and create service accounts
  enable_apis                   = true
  create_service_accounts       = false  # Start with existing service accounts
  create_dev_service_accounts   = true   # Create dedicated dev service accounts
}
