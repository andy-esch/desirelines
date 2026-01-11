# Docker Image Validation
# Validates that all required images exist in Artifact Registry before deployment.
# Fails fast at plan time with clear error message if images are missing.

locals {
  cloud_run_images = {
    dispatcher      = "dispatcher"
    apigateway      = "apigateway"
    bq_inserter     = "bq-inserter"
    postgres_writer = "postgres-writer"
  }
}

# Check if each image exists in Artifact Registry
# Returns {"exists": "true"} or {"exists": "false"}
data "external" "image_exists" {
  for_each = local.cloud_run_images

  program = ["bash", "-c", <<-EOF
    if gcloud artifacts docker images describe "${var.external_artifact_registry}/${each.value}:${var.deployment_version}" >/dev/null 2>&1; then
      echo '{"exists":"true","image":"${each.value}:${var.deployment_version}"}'
    else
      echo '{"exists":"false","image":"${each.value}:${var.deployment_version}"}'
    fi
  EOF
  ]
}

# Validation check that fails plan if any image is missing
resource "terraform_data" "image_validation" {
  lifecycle {
    precondition {
      condition     = data.external.image_exists["dispatcher"].result.exists == "true"
      error_message = "Image not found: ${var.external_artifact_registry}/dispatcher:${var.deployment_version}\nRun 'just build-publish' first."
    }
    precondition {
      condition     = data.external.image_exists["apigateway"].result.exists == "true"
      error_message = "Image not found: ${var.external_artifact_registry}/apigateway:${var.deployment_version}\nRun 'just build-publish' first."
    }
    precondition {
      condition     = data.external.image_exists["bq_inserter"].result.exists == "true"
      error_message = "Image not found: ${var.external_artifact_registry}/bq-inserter:${var.deployment_version}\nRun 'just build-publish' first."
    }
    precondition {
      condition     = data.external.image_exists["postgres_writer"].result.exists == "true"
      error_message = "Image not found: ${var.external_artifact_registry}/postgres-writer:${var.deployment_version}\nRun 'just build-publish' first."
    }
  }
}
