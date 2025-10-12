#!/bin/bash

# Bootstrap Terraform Service Account for New Environment
# Usage: ./scripts/infrastructure/bootstrap-terraform-sa.sh <environment>
# Example: ./scripts/infrastructure/bootstrap-terraform-sa.sh dev

set -e

ENV_NAME="$1"
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

echo "🚀 Bootstrapping Terraform Service Account for $ENV_NAME environment"
echo "   Project: $PROJECT_ID"
echo "   Service Account: $SA_EMAIL"

# Verify we're in the correct project
CURRENT_PROJECT=$(gcloud config get-value project)
if [[ "$CURRENT_PROJECT" != "$PROJECT_ID" ]]; then
    echo "❌ Error: Current gcloud project ($CURRENT_PROJECT) doesn't match expected ($PROJECT_ID)"
    echo "   Run: gcloud config set project $PROJECT_ID"
    exit 1
fi

# Create the service account
echo "📝 Creating service account..."
gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Terraform Desirelines $ENV_NAME Environment" \
    --description="Service account for managing Terraform infrastructure in $ENV_NAME environment" \
    || echo "⚠️  Service account may already exist"

# Grant required roles
echo "🔐 Granting IAM roles..."
for role in \
    "roles/artifactregistry.admin" \
    "roles/bigquery.admin" \
    "roles/cloudfunctions.admin" \
    "roles/pubsub.admin" \
    "roles/iam.serviceAccountAdmin" \
    "roles/resourcemanager.projectIamAdmin" \
    "roles/editor" \
    "roles/secretmanager.admin"
do
    echo "   Adding role: $role"
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$role"
done

# Grant current user permission to impersonate the service account
echo "🔐 Granting impersonation permissions to current user..."
CURRENT_USER=$(gcloud config get-value account)
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --member="user:$CURRENT_USER" \
    --role="roles/iam.serviceAccountTokenCreator"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --member="user:$CURRENT_USER" \
    --role="roles/iam.serviceAccountUser"

# Grant cross-project permissions for prod environment
if [ "$ENV_NAME" = "prod" ]; then
    echo "🔗 Setting up cross-project permissions..."
    echo "   Granting read access to dev project resources..."

    # Grant read access to dev project for Terraform state and function sources
    echo "   Granting terraform SA access to dev project..."
    gcloud projects add-iam-policy-binding "desirelines-dev" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="roles/storage.bucketViewer" || echo "     ⚠️  Warning: Could not grant bucket read access"

    gcloud projects add-iam-policy-binding "desirelines-dev" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="roles/storage.objectViewer" || echo "     ⚠️  Warning: Could not grant object read access"

    # Grant Cloud Functions service account access to dev function sources
    PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
    CF_SERVICE_ACCOUNT="service-$PROJECT_NUMBER@gcf-admin-robot.iam.gserviceaccount.com"
    echo "   Granting Cloud Functions service ($CF_SERVICE_ACCOUNT) access to dev function sources..."
    if gcloud projects add-iam-policy-binding "desirelines-dev" \
        --member="serviceAccount:$CF_SERVICE_ACCOUNT" \
        --role="roles/storage.objectViewer"; then
        echo "   ✅ Cloud Functions service granted object read access to dev project"
    else
        echo "   ❌ Failed to grant CF service object read access to dev project"
        echo "   You may need to run this manually:"
        echo "   gcloud projects add-iam-policy-binding desirelines-dev \\"
        echo "     --member=\"serviceAccount:$CF_SERVICE_ACCOUNT\" \\"
        echo "     --role=\"roles/storage.objectViewer\""
    fi

    echo "   ✅ Cross-project read permissions configured"
fi

echo "✅ Terraform service account bootstrap complete!"
echo "📋 Summary:"
echo "   Service Account: $SA_EMAIL"
echo "   Roles: Artifact Registry Admin, BigQuery Admin, Cloud Functions Admin, PubSub Admin, IAM SA Admin, Project IAM Admin, Editor, Secret Manager Admin"
echo "   Impersonation: $CURRENT_USER can impersonate this service account"
if [ "$ENV_NAME" = "prod" ]; then
    echo "   Cross-project: Read access to desirelines-dev resources"
fi
echo ""
echo "🔄 Next steps:"
echo "   1. Set up temporary impersonation:"
echo "      make impersonate-terraform"
echo "   2. Run terraform bootstrap:"
echo "      cd terraform && terraform apply -var=\"gcp_project_id=$PROJECT_ID\""
