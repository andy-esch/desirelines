# Production environment configuration

terraform {
  required_version = ">= 1.0"

  # Production uses remote state storage
  backend "gcs" {
    bucket = "desirelines-prod-terraform-state"
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
  project_name       = "desirelines"
  environment        = "prod"
  gcp_project_id     = var.gcp_project_id
  gcp_project_number = var.gcp_project_number
  gcp_region         = var.gcp_region

  # Cross-project function source sharing (use dev bucket)
  external_function_source_bucket = "desirelines-dev-function-source"

  # Production settings
  bigquery_location = "US"
  storage_location  = "US"

  # Use default compute service account initially (will be replaced with dedicated SAs)
  service_account_email = "${var.gcp_project_number}-compute@developer.gserviceaccount.com"

  # Enable APIs and create service accounts
  enable_apis                 = true
  create_service_accounts     = true   # Create terraform and infrastructure service accounts
  create_dev_service_accounts = false  # Dev service accounts only in dev

  # Function deployment configuration (uses dev-built sources)
  function_source_tag = var.function_source_tag

  # Use "full" mode for complete cloud deployment
  # This creates all resources: Cloud Functions, PubSub, BigQuery, Storage, etc.
  deployment_mode = "full"

  # Developer access
  developer_email = var.developer_email
}
