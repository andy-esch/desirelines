# Desirelines Infrastructure Module

Main Terraform module for the Desirelines project. Provisions all GCP resources for a single environment (dev or prod).

## Resources Managed

| File | Resources |
|------|-----------|
| `cloud_run.tf` | Cloud Run services (dispatcher, api-gateway, bq-inserter, postgres-writer), service accounts, IAM |
| `pubsub_subscriptions.tf` | PubSub topics, push subscriptions, dead letter queues |
| `main.tf` | BigQuery dataset/tables, Firestore database, Cloud Storage, GCP APIs |
| `firebase_hosting.tf` | Firebase Hosting site, custom domain, web app config |
| `eventarc.tf` | Eventarc triggers for Cloud Run services |
| `monitoring.tf` | Monitoring alerts and notification channels |
| `image_validation.tf` | Container image tag validation |

## Usage

This module is referenced by the private `desirelines-deploy` repo via git tags:

```hcl
module "desirelines" {
  source = "git::https://github.com/andy-esch/desirelines.git//terraform/modules/desirelines?ref=tf-N"

  gcp_project_id     = var.gcp_project_id
  gcp_project_number = var.gcp_project_number
  environment        = "dev"
  infisical_project_id = var.infisical_project_id
}
```

See `variables.tf` for all available inputs and `outputs.tf` for all outputs.

## Related

- [Terraform README](../../README.md) - Module versioning and tagging workflow
- [Bootstrap Guide](../../../docs/guides/bootstrap.md) - Initial environment setup
- [Deployment Guide](../../../docs/guides/deployment.md) - Deployment procedures
- [GitHub Actions WIF Module](../github-actions-wif/README.md) - CI/CD authentication
