# Deployment Scripts

Scripts for deploying applications and infrastructure.

- `deploy-web.sh <environment>`: Deploy React frontend and current Firestore rules.
  For a frontend rollback use `--hosting-only` from a revision that supports it;
  never run an older combined deploy that restores permissive rules. See the
  [connection registry rollout](../../../docs/guides/activity-connection-registry.md).
- `build-and-publish.sh`: Build and publish local Docker images with Buildx.
  These images do not have hosted GitHub release attestations. For a signed
  release, commit the build inputs and merge to main; see the
  [deployment guide](../../../docs/guides/deployment.md#signed-release-image-provenance).
