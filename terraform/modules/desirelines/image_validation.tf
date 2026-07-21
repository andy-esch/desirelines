# Docker Image Validation
# Validates that every image a plan intends to deploy actually exists in Artifact
# Registry. Fails fast at plan time with a clear error message if one is missing.
#
# Validates `local.image_ref` — the exact reference the container blocks use — rather
# than re-deriving one from the tag. Two reasons:
#   1. Once digests are committed per environment, the tag for a given commit may not
#      exist at all: a service whose source didn't change isn't rebuilt, so no tag is
#      pushed for that version while its digest carries forward unchanged. Checking the
#      tag would fail a plan that is entirely correct.
#   2. It checks what will actually be deployed, so a digest that has since aged out of
#      the registry is still caught.
#
# This lookup feeds preconditions only. Plan output does not depend on it, so the
# rendered image reference stays a pure function of committed inputs.

locals {
  cloud_run_images = toset(["dispatcher", "apigateway", "stravapipe"])
}

# Check that each image reference resolves in Artifact Registry.
# Returns {"exists": "true"} or {"exists": "false"}
data "external" "image_exists" {
  for_each = local.cloud_run_images

  program = ["bash", "-c", <<-EOF
    if gcloud artifacts docker images describe "${local.image_ref[each.value]}" >/dev/null 2>&1; then
      echo '{"exists":"true"}'
    else
      echo '{"exists":"false"}'
    fi
  EOF
  ]
}

# Validation check that fails plan if any image is missing
resource "terraform_data" "image_validation" {
  lifecycle {
    precondition {
      condition     = data.external.image_exists["dispatcher"].result.exists == "true"
      error_message = "Image not found: ${local.image_ref.dispatcher}\nRun 'just build-publish' first."
    }
    precondition {
      condition     = data.external.image_exists["apigateway"].result.exists == "true"
      error_message = "Image not found: ${local.image_ref.apigateway}\nRun 'just build-publish' first."
    }
    precondition {
      condition     = data.external.image_exists["stravapipe"].result.exists == "true"
      error_message = "Image not found: ${local.image_ref.stravapipe}\nRun 'just build-publish' first."
    }
  }
}
