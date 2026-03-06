# Go Dispatcher - Cloud Run Service
# Multi-stage build for optimal container size

# Build stage
FROM golang:1.26-alpine AS builder

# Building from repository root context to allow access to local shared packages.
WORKDIR /app

# Mirror repo structure for module manifests to satisfy local 'replace' directives.
COPY packages/shared/go.mod packages/shared/go.sum* ./packages/shared/
COPY packages/dispatcher/go.mod packages/dispatcher/go.sum* ./packages/dispatcher/

WORKDIR /app/packages/dispatcher

# Download dependencies
RUN go mod download
RUN go mod verify

# Mirror source code structure to resolve '../shared' at compile time.
COPY packages/shared/ ../shared/
COPY packages/dispatcher/ .

# Build the application from cmd/dispatcher (package main)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o /app/dispatcher ./cmd/dispatcher

# Runtime stage - distroless for minimal attack surface
# :nonroot tag provides a non-root user (UID 65534) with no shell or package manager
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /app/dispatcher /dispatcher

# Service listens on PORT environment variable
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/dispatcher"]
