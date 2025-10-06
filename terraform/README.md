# Terraform Infrastructure Setup

This directory contains Terraform configurations for deploying the Desirelines infrastructure across different environments.

## Prerequisites

1. **Google Cloud SDK** installed and authenticated
2. **Terraform** >= 1.0 installed
3. **Google Cloud Project** with billing enabled
4. **Required GCP APIs** will be enabled automatically by Terraform

## Initial Setup

### 1. Configure Your Project

Copy the example configuration files and customize for your GCP project:

```bash
# Copy example files
cp terraform.tfvars.example terraform.tfvars
cp environments/dev/terraform.tfvars.example environments/dev/terraform.tfvars
cp environments/local/terraform.tfvars.example environments/local/terraform.tfvars

# Edit each file with your project details
```

### 2. Create Terraform State Bucket (for dev/prod environments)

```bash
# Create a globally unique bucket for Terraform state
gsutil mb gs://your-project-terraform-state

# Enable versioning for safety
gsutil versioning set on gs://your-project-terraform-state
```

## Environment Configurations

### Local Development (`environments/local/`)
- Uses local state storage
- For testing Terraform configurations
- Creates resources with `local` environment prefix

### Development (`environments/dev/`)
- Uses remote state storage in GCS
- Shared development environment
- Creates resources with `dev` environment prefix

## Usage

### Deploy Local Environment
```bash
cd environments/local
terraform init
terraform plan
terraform apply
```

### Deploy Development Environment
```bash
cd environments/dev

# Initialize with your state bucket
terraform init -backend-config="bucket=your-project-terraform-state"

# Deploy with specific image tag (git SHA)
SHA=$(git rev-parse --short HEAD)
terraform apply -var="function_image_tag=$SHA"
```

## Configuration Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `gcp_project_id` | Your GCP Project ID | `"my-project-123"` |
| `gcp_project_number` | Your GCP Project Number | `"123456789012"` |
| `gcp_region` | Primary GCP region | `"us-central1"` |
| `function_image_tag` | Container image tag | `"abc1234"` (git SHA) |

## Security Notes

- **Never commit `*.tfvars` files** - they contain project-specific configuration
- **Use service account impersonation** - no need to manage key files locally
- **State files contain sensitive data** - ensure proper GCS bucket permissions

For detailed setup instructions, see [docs/guides/bootstrap.md](../docs/guides/bootstrap.md).
