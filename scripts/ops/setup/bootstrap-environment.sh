#!/usr/bin/env bash

# Complete Environment Bootstrap Script
# Prerequisites: Set your gcloud project to match the environment first
# Usage:
#   gcloud config set project desirelines-<environment>
#   ./scripts/bootstrap-environment.sh <environment>
# Example:
#   gcloud config set project desirelines-dev
#   ./scripts/bootstrap-environment.sh dev

set -euo pipefail

# Default expansion keeps `set -u` from short-circuiting before the
# helpful usage message below when no argument is supplied.
ENV_NAME="${1:-}"
if [[ -z "$ENV_NAME" ]]; then
	echo "❌ Error: Environment name required"
	echo "Usage: $0 <environment>"
	echo "Example: $0 dev"
	exit 1
fi

if [[ ! "$ENV_NAME" =~ ^(dev|prod|local)$ ]]; then
	echo "❌ Error: Environment must be 'dev', 'prod', or 'local'"
	exit 1
fi

PROJECT_ID="desirelines-$ENV_NAME"
SA_NAME="terraform-desirelines"
SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

echo "🚀 Bootstrapping complete $ENV_NAME environment for desirelines"
echo "   Project: $PROJECT_ID"
echo "   This will take 5-10 minutes..."
echo ""

# =============================================================================
# Step 1: Validate Prerequisites
# =============================================================================
echo "1️⃣ Validating prerequisites..."

# Check if project exists and we can access it
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
	echo "❌ Error: Project $PROJECT_ID does not exist or you don't have access"
	echo "   Please create the project first: gcloud projects create $PROJECT_ID"
	exit 1
fi

# Validate current project matches requested environment
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [[ "$CURRENT_PROJECT" != "$PROJECT_ID" ]]; then
	echo "❌ Error: Current gcloud project ($CURRENT_PROJECT) doesn't match requested environment ($ENV_NAME)"
	echo "   Please switch to the correct project first:"
	echo "   gcloud config set project $PROJECT_ID"
	echo ""
	echo "   Then run this script again:"
	echo "   $0 $ENV_NAME"
	exit 1
fi

echo "✅ Current project ($CURRENT_PROJECT) matches requested environment ($ENV_NAME)"

# Check billing
if ! gcloud billing projects describe "$PROJECT_ID" >/dev/null 2>&1; then
	echo "❌ Error: Billing not enabled for $PROJECT_ID"
	echo "   Please enable billing: https://console.cloud.google.com/billing"
	exit 1
fi

echo "✅ Prerequisites validated"

# =============================================================================
# Step 2: Create Terraform Service Account
# =============================================================================
echo ""
echo "2️⃣ Creating terraform service account..."

# Enable all required APIs
echo "   Enabling required APIs..."
gcloud services enable \
	iam.googleapis.com \
	cloudresourcemanager.googleapis.com \
	artifactregistry.googleapis.com \
	cloudfunctions.googleapis.com \
	cloudbuild.googleapis.com \
	eventarc.googleapis.com \
	run.googleapis.com \
	pubsub.googleapis.com \
	bigquery.googleapis.com \
	secretmanager.googleapis.com \
	storage.googleapis.com \
	--quiet

# Create service account
echo "   Creating service account: $SA_EMAIL"
if gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
	echo "   ✅ Service account already exists"
else
	echo "   Creating new service account..."
	if gcloud iam service-accounts create "$SA_NAME" \
		--display-name="Terraform Desirelines $ENV_NAME Environment" \
		--description="Service account for managing Terraform infrastructure in $ENV_NAME environment"; then
		echo "   ✅ Service account created successfully"
	else
		echo "   ❌ Error: Failed to create service account $SA_EMAIL"
		echo "   Please check permissions and try again"
		exit 1
	fi
fi

# Grant project-level roles
for role in \
	"roles/artifactregistry.admin" \
	"roles/bigquery.admin" \
	"roles/cloudfunctions.admin" \
	"roles/pubsub.admin" \
	"roles/iam.serviceAccountAdmin" \
	"roles/resourcemanager.projectIamAdmin" \
	"roles/editor" \
	"roles/secretmanager.admin"; do
	gcloud projects add-iam-policy-binding "$PROJECT_ID" \
		--member="serviceAccount:$SA_EMAIL" \
		--role="$role" --quiet
done

# Grant impersonation permissions
CURRENT_USER=$(gcloud config get-value account)
echo "   Granting impersonation permissions to $CURRENT_USER"

echo "     Adding roles/iam.serviceAccountTokenCreator..."
if gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
	--member="user:$CURRENT_USER" \
	--role="roles/iam.serviceAccountTokenCreator"; then
	echo "     ✅ serviceAccountTokenCreator granted"
else
	echo "     ❌ Failed to grant serviceAccountTokenCreator"
	exit 1
fi

echo "     Adding roles/iam.serviceAccountUser..."
if gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
	--member="user:$CURRENT_USER" \
	--role="roles/iam.serviceAccountUser"; then
	echo "     ✅ serviceAccountUser granted"
else
	echo "     ❌ Failed to grant serviceAccountUser"
	exit 1
fi

# Grant cross-project permissions for prod environment
if [ "$ENV_NAME" = "prod" ]; then
	echo "   Setting up cross-project permissions..."
	echo "     Granting read access to dev project resources..."

	# Grant read access to dev project for Terraform state and function sources
	# Need both bucket metadata (bucketViewer) and object access (objectViewer)
	gcloud projects add-iam-policy-binding "desirelines-dev" \
		--member="serviceAccount:$SA_EMAIL" \
		--role="roles/storage.bucketViewer" || echo "     ⚠️  Warning: Could not grant bucket read access"

	gcloud projects add-iam-policy-binding "desirelines-dev" \
		--member="serviceAccount:$SA_EMAIL" \
		--role="roles/storage.objectViewer" || echo "     ⚠️  Warning: Could not grant object read access"

	# Grant Cloud Functions service account access to dev function sources
	PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
	CF_SERVICE_ACCOUNT="service-$PROJECT_NUMBER@gcf-admin-robot.iam.gserviceaccount.com"
	echo "     Granting Cloud Functions service ($CF_SERVICE_ACCOUNT) access to dev function sources..."
	if gcloud projects add-iam-policy-binding "desirelines-dev" \
		--member="serviceAccount:$CF_SERVICE_ACCOUNT" \
		--role="roles/storage.objectViewer"; then
		echo "     ✅ Cloud Functions service granted object read access to dev project"
	else
		echo "     ❌ Failed to grant CF service object read access to dev project"
		echo "     You may need to run this manually:"
		echo "     gcloud projects add-iam-policy-binding desirelines-dev \\"
		echo "       --member=\"serviceAccount:$CF_SERVICE_ACCOUNT\" \\"
		echo "       --role=\"roles/storage.objectViewer\""
		exit 1
	fi

	echo "     ✅ Cross-project read permissions configured"
fi

echo "✅ Terraform service account created with proper permissions"

# =============================================================================
# Step 3: Set up authentication and create state bucket
# =============================================================================
echo ""
echo "3️⃣ Setting up authentication and terraform state..."

# Set up impersonation
echo "   Setting up service account impersonation..."
if gcloud auth application-default print-access-token >/dev/null 2>&1; then
	echo "   ✅ Authentication already configured"
else
	echo "   ⚠️  Please configure impersonation manually:"
	echo "      just auth-impersonate"
	echo "   This sets temporary impersonation (recommended over permanent application default credentials)"
	exit 1
fi

# Create terraform state bucket
cd terraform
terraform init
terraform apply -var="gcp_project_id=$PROJECT_ID" -auto-approve
cd ..

echo "✅ Terraform state bucket created"

# =============================================================================
# Step 4: Verify Infisical secrets configuration
# =============================================================================
echo ""
echo "4️⃣ Verifying secrets configuration..."

# Secrets are managed in Infisical and synced to GCP Secret Manager.
# Terraform will create the secret containers; Infisical populates the values.
# See docs/guides/secrets.md for setup instructions.

echo "   Secrets are managed via Infisical."
echo "   Ensure the following before proceeding:"
echo "   1. Infisical project has secrets in /backend/secrets for $ENV_NAME environment"
echo "   2. GCP Secret Manager sync is configured in Infisical"
echo ""
echo "   See docs/guides/secrets.md for details."
echo ""
read -p "Have you configured Infisical secrets for $ENV_NAME? (y/N): " -r </dev/tty
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
	echo "❌ Please configure Infisical secrets first, then re-run this script."
	exit 1
fi

echo "✅ Secrets configuration verified"

# =============================================================================
# Step 5: Package functions (skip for local environment)
# =============================================================================
echo ""

if [[ "$ENV_NAME" == "local" ]]; then
	echo "5️⃣ Skipping function packaging (local environment)"
	echo "   Functions will run locally in Docker containers"
	CURRENT_SHA="local-dev"
else
	echo "5️⃣ Packaging functions..."
	pants package functions::
	CURRENT_SHA=$(git rev-parse --short HEAD)
	echo "✅ Functions packaged with SHA: $CURRENT_SHA"
fi

# =============================================================================
# Step 6: Deploy infrastructure
# =============================================================================
echo ""
echo "6️⃣ Deploying infrastructure..."

cd "terraform/environments/$ENV_NAME"
terraform init -backend-config="bucket=$PROJECT_ID-terraform-state"
terraform apply -var="function_source_tag=$CURRENT_SHA" -auto-approve
cd ../../..

echo "✅ Infrastructure deployed"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "🎉 Bootstrap complete for $ENV_NAME environment!"
echo ""
echo "📋 Summary:"
echo "   Project: $PROJECT_ID"
echo "   Terraform SA: $SA_EMAIL"
echo "   Function SHA: $CURRENT_SHA"
echo "   State bucket: $PROJECT_ID-terraform-state"
echo ""
echo "🔄 Next steps:"
echo "   • Test the webhook endpoint"
echo "   • Verify BigQuery datasets were created"
echo "   • Check Cloud Functions are deployed"
echo ""
echo "⚡ To deploy updates:"
echo "   pants package functions::"
echo "   cd terraform/environments/$ENV_NAME"
echo "   terraform apply -var=\"function_source_tag=\$(git rev-parse --short HEAD)\""
