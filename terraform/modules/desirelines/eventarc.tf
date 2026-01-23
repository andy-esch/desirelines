# ==============================================================================
# Eventarc Triggers - DEPRECATED
# ==============================================================================
# This file previously contained Eventarc triggers for Pub/Sub -> Cloud Run delivery.
#
# MIGRATION NOTE (2025-01):
# Eventarc triggers have been replaced with explicit Pub/Sub push subscriptions
# in pubsub_subscriptions.tf. This provides:
#
# - Stable subscription names across deployments (no random suffixes)
# - DLQ configuration from creation (not added post-hoc)
# - Full Terraform lifecycle management
# - Explicit retry and ack deadline configuration
# - No orphaned subscriptions on redeploy
#
# See: docs/architecture/pubsub-subscription-design.md
# Related incident: docs/incidents/2025-10-08-duplicate-subscriptions.md
# ==============================================================================

# Eventarc triggers removed - push subscriptions now defined in pubsub_subscriptions.tf
