output "repository_name" {
  description = "Name of the Artifact Registry repository"
  value       = google_artifact_registry_repository.services.name
}

output "repository_url" {
  description = "Full URL for pushing/pulling images"
  value       = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.services.repository_id}"
}

output "image_base_url" {
  description = "Base URL for container images (append /<image>:<tag>)"
  value       = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.services.repository_id}"
}
