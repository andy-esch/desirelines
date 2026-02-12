# Bootstrap Scripts

This directory contains initialization scripts used by Docker Compose to set up the local development environment.

## Scripts

### `pubsub-emulator.sh`

**Usage**: Automatically executed by the `pubsub-bootstrap` service in `docker-compose.yml`.

**Purpose**:

1. Waits for the Pub/Sub emulator to become available.
2. Creates the `desirelines_activity_events` topic.
3. Creates push subscriptions that route messages to the `cloudevent-adapter` service.
