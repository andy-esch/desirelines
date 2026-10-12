# Deployment Scripts

Scripts for deploying applications and infrastructure.

- `deploy-web.sh`: Deploy React frontend to Firebase.
- `build-and-publish.sh`: Build and publish local Docker images with Buildx.
  These images do not have hosted GitHub release attestations. For a signed
  release, commit the build inputs and merge to main; see the
  [deployment guide](../../../docs/guides/deployment.md#signed-release-image-provenance).
