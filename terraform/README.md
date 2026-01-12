# Terraform Infrastructure

Terraform configurations for Desirelines infrastructure.

## Prerequisites

- **Terraform** 1.14.3 (pinned in `.terraform-version`)
- **Google Cloud SDK** authenticated
- **GCP Project** with billing enabled
- **pre-commit** installed (for validation hooks)

## Quick Start

```bash
# Dev environment
just tf-dev-init
just tf-dev-plan
just tf-dev-apply   # requires confirmation

# Prod environment
just tf-prod-init
just tf-prod-plan
just tf-prod-apply  # requires typing "production"
```

## Task Runner (just)

| Target | Description |
|--------|-------------|
| `tf-dev-init` | Initialize dev backend |
| `tf-dev-plan` | Plan dev changes |
| `tf-dev-apply` | Apply to dev (confirmation required) |
| `tf-dev-drift` | Check for drift in dev |
| `tf-prod-init` | Initialize prod backend |
| `tf-prod-plan` | Plan prod changes |
| `tf-prod-apply` | Apply to prod (confirmation required) |
| `tf-prod-drift` | Check for drift in prod |
| `tf-fmt` | Format all .tf files |
| `tf-validate-all` | Validate all environments |

## Directory Structure

```
terraform/
├── .terraform-version     # Pinned version (1.14.3)
├── environments/
│   ├── artifacts/         # Shared artifact registry
│   ├── dev/               # Development environment
│   └── prod/              # Production environment
└── modules/
    ├── desirelines/       # Main infrastructure module
    └── github-actions-wif/ # Workload Identity Federation
```

## CI/CD

- **CI validation**: `terraform fmt -check` and `terraform validate` on PRs
- **Deployment**: Merge to main auto-deploys to dev; prod requires manual trigger
- **Drift detection**: Runs daily, creates GitHub issue if drift found

See [docs/guides/ci.md](../docs/guides/ci.md) for details.

## Pre-commit Hooks

Terraform validation runs automatically on commit when `.tf` files are staged:

```yaml
# .pre-commit-config.yaml
- repo: https://github.com/antonbabenko/pre-commit-terraform
  hooks:
  - id: terraform_fmt
  - id: terraform_validate
```

Install: `pre-commit install`

## Configuration

Copy example files and customize:

```bash
cp environments/dev/terraform.tfvars.example environments/dev/terraform.tfvars
```

| Variable | Description |
|----------|-------------|
| `gcp_project_id` | GCP Project ID |
| `gcp_project_number` | GCP Project Number |
| `deployment_version` | Container image tag (git SHA) |

## Image Validation

Terraform validates that all Docker images exist in Artifact Registry before deployment.
If images are missing, `terraform plan` fails with a clear error:

```
Error: Image not found: .../dispatcher:abc1234
Run 'just build-publish' first.
```

This prevents partial deployments when images haven't been built.

## Security

- Never commit `*.tfvars` files (contain project config)
- State files stored in GCS with versioning
- Sensitive outputs marked with `sensitive = true`

## Related

- [Bootstrap Guide](../docs/guides/bootstrap.md) - Initial environment setup
- [Deployment Guide](../docs/guides/deployment.md) - Deployment procedures
- [CI Guide](../docs/guides/ci.md) - CI/CD pipeline
