# Terraform Infrastructure

Terraform modules and build infrastructure for Desirelines.

## Architecture

This repo contains **modules** and the **artifacts** environment only. Deployment environments (dev, prod) live in the private `desirelines-deploy` repo for GitOps with committed sensitive values.

| Location | Purpose |
|----------|---------|
| `modules/desirelines/` | Main infrastructure module (Cloud Run, PubSub, BigQuery, etc.) |
| `modules/github-actions-wif/` | Workload Identity Federation module |
| `environments/artifacts/` | Artifact Registry (shared across environments) |

## Prerequisites

- **Terraform** (version pinned in `.terraform-version`)
- **Python 3** for the cloud-free table lifecycle tests
- **Google Cloud SDK** authenticated
- **pre-commit** installed (for validation hooks)

## Directory Structure

```
terraform/
├── .terraform-version      # Pinned version
├── .tflint.hcl             # TFLint configuration (Google ruleset)
├── .terraform-docs.yml     # terraform-docs configuration
├── environments/
│   └── artifacts/          # Shared artifact registry (desirelines-artifacts project)
└── modules/
    ├── desirelines/        # Main infrastructure module
    └── github-actions-wif/ # Workload Identity Federation
```

## Module Development

Modules in this repo are referenced by the deploy repo via git tags:

```hcl
module "desirelines" {
  source = "git::https://github.com/andy-esch/desirelines.git//terraform/modules/desirelines?ref=tf-1"
}
```

When making module changes:

1. Make changes to `terraform/modules/`
2. Merge to main
3. The [release workflow](../.github/workflows/deploy.yml) publishes the next `tf-N` tag for module or schema changes
4. Deploy repo updates module refs (manually or via Renovate)

## Artifacts Environment

The `artifacts/` environment manages the Artifact Registry in the `desirelines-artifacts` GCP project. This rarely changes and is applied manually:

```bash
cd terraform/environments/artifacts
terraform init
terraform plan
terraform apply
```

## CI/CD

- **CI validation**: formatting, validation, module/lifecycle tests, TFLint and terraform-docs checks on PRs
- **Deployment**: Handled by `desirelines-deploy` repo

See [docs/guides/ci.md](../docs/guides/ci.md) for details.

## Local Tooling

```bash
just tf-fmt            # Format all .tf files
just tf-validate-all   # Validate all environments and modules
just tf-test           # Test contracts and table lifecycle without cloud credentials
just tf-lint           # Lint with TFLint (Google ruleset)
just tf-docs           # Regenerate module documentation
```

`tf-test` uses mocked module tests plus [real-provider plans](../scripts/ci/activity_table_lifecycle.py)
against synthetic state. It checks description updates and destruction protection
in dev/prod without refreshing or applying cloud resources. It does not replace
the [live table-preservation checkpoint](../docs/runbooks/activity-row-schema-changes.md#verify-a-description-only-table-edit).

## Security

- State files stored in GCS with versioning
- Sensitive outputs marked with `sensitive = true`
- Sensitive tfvars committed only in the private deploy repo

## Related

- [Bootstrap Guide](../docs/guides/bootstrap.md) - Initial environment setup
- [Deployment Guide](../docs/guides/deployment.md) - Deployment procedures
- [CI Guide](../docs/guides/ci.md) - CI/CD pipeline
