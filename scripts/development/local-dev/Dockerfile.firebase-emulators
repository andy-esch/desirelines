# Firebase Emulator Suite for local development
# Runs Auth + Firestore emulators for fully offline development
FROM node:20-slim

# Pin firebase-tools version for reproducibility
ARG FIREBASE_TOOLS_VERSION=13.29.1

# Install firebase-tools, curl for healthcheck, and Java for emulators
RUN npm install -g firebase-tools@${FIREBASE_TOOLS_VERSION} && \
    apt-get update && \
    apt-get install -y --no-install-recommends curl openjdk-17-jre-headless && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy firebase configuration
COPY firebase-emulators.json firebase.json

# Expose ports for Auth, Firestore, and UI
EXPOSE 9099 8080 4000

# Run emulators (no auth required for emulators-only mode)
CMD ["firebase", "emulators:start", "--only", "auth,firestore", "--project", "desirelines-local"]
