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
3. Tag with next `tf-N` integer (e.g., `git tag tf-2 && git push origin tf-2`)
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

- **CI validation**: `terraform fmt -check`, `terraform validate`, TFLint, and terraform-docs checks on PRs
- **Deployment**: Handled by `desirelines-deploy` repo

See [docs/guides/ci.md](../docs/guides/ci.md) for details.

## Local Tooling

```bash
just tf-fmt            # Format all .tf files
just tf-validate-all   # Validate all environments and modules
just tf-lint           # Lint with TFLint (Google ruleset)
just tf-docs           # Regenerate module documentation
```

## Security

- State files stored in GCS with versioning
- Sensitive outputs marked with `sensitive = true`
- Sensitive tfvars committed only in the private deploy repo

## Related

- [Bootstrap Guide](../docs/guides/bootstrap.md) - Initial environment setup
- [Deployment Guide](../docs/guides/deployment.md) - Deployment procedures
- [CI Guide](../docs/guides/ci.md) - CI/CD pipeline
