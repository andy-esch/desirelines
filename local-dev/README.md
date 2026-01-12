# Local Development Infrastructure

This directory contains infrastructure components and scripts specifically for the local development environment. These resources are used by `docker-compose.yml` to spin up a local replica of the production environment.

## Directory Structure

```text
/local-dev/
  ├── containers/                   # Dev-only containers (not used in production)
  │   ├── cloudevent-adapter/       # Bridges PubSub emulator to Cloud Run services
  │   └── firebase-emulators/       # Local Firebase Auth & Firestore emulators
  ├── bootstrap/                    # Initialization scripts
  │   └── pubsub-emulator.sh        # Creates topics/subscriptions in the emulator
  └── README.md                     # This file
```

## Components

### Containers

#### CloudEvent Adapter
*   **Path**: `local-dev/containers/cloudevent-adapter/`
*   **Purpose**: Bridges the gap between the PubSub Emulator (which sends raw push messages) and Cloud Run services (which expect Eventarc-formatted CloudEvents).
*   **Usage**: Automatically built and started by `docker-compose.yml`.

#### Firebase Emulators
*   **Path**: `local-dev/containers/firebase-emulators/`
*   **Purpose**: Provides local Authentication and Firestore services.
*   **Usage**: Accessed via port 9099 (Auth) and 8089 (Firestore).

### Bootstrap Scripts

#### PubSub Emulator Setup
*   **Path**: `local-dev/bootstrap/pubsub-emulator.sh`
*   **Purpose**: Waits for the emulator to start, then creates the `desirelines_activity_events` topic and necessary push subscriptions.
