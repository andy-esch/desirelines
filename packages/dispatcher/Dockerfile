# Go Dispatcher - Cloud Run Service
# Multi-stage build for optimal container size

# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy go module files (context is packages/dispatcher)
COPY go.mod ./
COPY go.sum* ./

# Download dependencies
RUN go mod download
RUN go mod verify

# Copy all source code
COPY . .

# Build the application from cmd/dispatcher (package main)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o /app/dispatcher ./cmd/dispatcher

# Runtime stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata wget

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /home/appuser

# Copy binary from builder (built to /app/dispatcher)
COPY --from=builder --chown=appuser:appgroup /app/dispatcher ./

# Grant execute permissions
RUN chmod +x ./dispatcher

# Switch to non-root user
USER appuser

# Service listens on PORT environment variable
ENV PORT=8080
EXPOSE 8080

CMD ["./dispatcher"]
