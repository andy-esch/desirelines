# Firebase Hosting Infrastructure
# Manages Firebase Hosting sites for the Desirelines web application
#
# Architecture:
# - Terraform manages hosting site infrastructure
# - Deployment scripts handle building and deploying web content
# - Pattern matches existing function deployment workflow

# ==============================================================================
# API Enablement
# ==============================================================================

resource "google_project_service" "firebase_hosting" {
  project = var.gcp_project_id
  service = "firebasehosting.googleapis.com"

  disable_on_destroy = false
}

# Firebase Management API (required for hosting site creation)
resource "google_project_service" "firebase" {
  project = var.gcp_project_id
  service = "firebase.googleapis.com"

  disable_on_destroy = false
}

# ==============================================================================
# Firebase Hosting Site
# ==============================================================================

# Create Firebase Hosting site for this environment
# Site ID format: desirelines-{environment}
# This creates the hosting infrastructure; content is deployed via firebase CLI
resource "google_firebase_hosting_site" "web_app" {
  provider = google-beta
  project  = var.gcp_project_id
  site_id  = "${var.project_name}-${var.environment}"

  depends_on = [
    google_project_service.firebase_hosting,
    google_project_service.firebase,
  ]
}

# ==============================================================================
# Custom Domain (Production Only)
# ==============================================================================

# Custom domain configuration for production environment
# Configured for: desirelines.andyes.ch (single clean URL for demo + personal data)
# Note: DNS records must be configured separately
resource "google_firebase_hosting_custom_domain" "app_subdomain" {
  provider = google-beta
  project  = var.gcp_project_id
  site_id  = google_firebase_hosting_site.web_app.site_id

  custom_domain = "desirelines.andyes.ch"

  # Only create for production environment
  count = var.environment == "prod" ? 1 : 0

  # Wait for status to become ACTIVE (DNS propagation + SSL provisioning)
  wait_dns_verification = true

  depends_on = [google_firebase_hosting_site.web_app]
}
