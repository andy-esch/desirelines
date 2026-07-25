# Go API Gateway - Cloud Run Service
# Multi-stage build for optimal container size

# Build stage
FROM golang:1.26-alpine AS builder

# Building from repository root context to allow access to local shared packages.
WORKDIR /app

# Mirror repo structure for module manifests to satisfy local 'replace' directives.
COPY packages/shared/go.mod packages/shared/go.sum* ./packages/shared/
COPY packages/apigateway/go.mod packages/apigateway/go.sum* ./packages/apigateway/

WORKDIR /app/packages/apigateway

# Download dependencies (go.sum provides checksum verification)
RUN go mod download

# Mirror source code structure to resolve '../shared' at compile time.
COPY packages/shared/ ../shared/
COPY packages/apigateway/ .

# Build the application from cmd/apigateway (package main)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o /app/apigateway ./cmd/apigateway

# Runtime stage - distroless for minimal attack surface
# :nonroot tag provides a non-root user (UID 65534) with no shell or package manager
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /app/apigateway /apigateway

# Service listens on PORT environment variable
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/apigateway"]
