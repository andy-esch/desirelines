# Format all Terraform files recursively
tf-fmt:
    @echo "🎨 Formatting all Terraform files..."
    terraform fmt -recursive terraform/

# Validate Terraform configuration for environment
tf-validate env:
    @echo "🔍 Validating Terraform in {{env}}..."
    cd terraform/environments/{{env}} && terraform init -backend=false && terraform validate

# Validate ALL Terraform configurations (artifacts environment + modules)
tf-validate-all:
    just tf-validate artifacts
    @echo "🔍 Validating modules..."
    (cd terraform/modules/desirelines && terraform init -backend=false && terraform validate)
    (cd terraform/modules/github-actions-wif && terraform init -backend=false && terraform validate)
    @echo "✅ All Terraform configurations are valid!"

# Lint Terraform files with TFLint
tf-lint:
    @echo "🔍 Linting Terraform files..."
    (cd terraform/modules/desirelines && tflint --config=../../.tflint.hcl --init && tflint --config=../../.tflint.hcl)
    (cd terraform/modules/github-actions-wif && tflint --config=../../.tflint.hcl --init && tflint --config=../../.tflint.hcl)
    (cd terraform/environments/artifacts && tflint --config=../../.tflint.hcl --init && tflint --config=../../.tflint.hcl)
    @echo "✅ All Terraform files pass linting!"

# Generate Terraform module documentation
tf-docs:
    @echo "📝 Generating Terraform docs..."
    terraform-docs terraform/modules/desirelines
    terraform-docs terraform/modules/github-actions-wif
    @echo "✅ Terraform docs generated!"
