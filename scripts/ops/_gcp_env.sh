#!/usr/bin/env bash

# Shared guards for ops scripts that act on a GCP environment.
# Source it, don't execute it:
#   source "$(dirname "${BASH_SOURCE[0]}")/_gcp_env.sh"
#
# The project guard is what stops a prod-shaped command from running against the
# wrong project, so it lives in one place rather than being re-typed per script.

# Validate an environment name. Sets nothing; exits on failure.
require_env_name() {
  local env_name="$1"
  if [[ ! "$env_name" =~ ^(dev|prod)$ ]]; then
    echo "❌ Error: Environment must be 'dev' or 'prod'"
    exit 1
  fi
}

# Resolve the active gcloud project and verify it matches the requested
# environment. Exports GCP_PROJECT_ID on success, exits on mismatch.
require_gcp_project() {
  local env_name="$1"

  GCP_PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
  if [ -z "$GCP_PROJECT_ID" ]; then
    echo "❌ Error: No GCP project set in gcloud config"
    echo "Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
  fi

  local expected_project="desirelines-${env_name}"
  if [ "$GCP_PROJECT_ID" != "$expected_project" ]; then
    echo "❌ Error: Project mismatch!"
    echo "   Requested environment: $env_name"
    echo "   Expected project:      $expected_project"
    echo "   Current project:       $GCP_PROJECT_ID"
    echo ""
    echo "Run: gcloud config set project $expected_project"
    exit 1
  fi
  echo "✅ Project verified: $GCP_PROJECT_ID"
  export GCP_PROJECT_ID
}

# Interactive confirmation for a destructive action, per
# docs/guides/secure-scripting.md rule 4. Prod requires the full word "yes" —
# a single-letter "y" is the canonical accidental-confirm shape — matching
# scripts/database/migrate.sh.
confirm_destructive() {
  local env_name="$1"
  local action="$2"
  local details="$3"

  echo ""
  echo "⚠️  $action"
  echo "$details"
  echo ""

  if [ "$env_name" = "prod" ]; then
    read -rp "Type 'yes' to confirm: " reply </dev/tty
    [ "$reply" = "yes" ] || {
      echo "❌ Operation cancelled"
      exit 1
    }
  else
    read -rp "Continue? (y/N): " reply </dev/tty
    [[ "$reply" =~ ^[Yy]$ ]] || {
      echo "❌ Operation cancelled"
      exit 1
    }
  fi
  echo ""
}
