# Production environment configuration

terraform {
  required_version = ">= 1.0"

  # Production uses remote state storage
  backend "gcs" {
    bucket = "desirelines-terraform-state"
    prefix = "environments/prod"
  }

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
  environment    = "prod"
  gcp_project_id = var.gcp_project_id
  gcp_region     = var.gcp_region

  # Production settings
  bigquery_location = "US"
  storage_location  = "US"

  # Use default compute service account initially (will be replaced with dedicated SAs)
  service_account_email = "${var.gcp_project_number}-compute@developer.gserviceaccount.com"

  # Enable APIs and create service accounts
  enable_apis            = true
  create_service_accounts = false  # Will be enabled in Phase 4.6
}
