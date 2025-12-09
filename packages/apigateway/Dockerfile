# Go API Gateway - Cloud Run Service
# Multi-stage build for optimal container size

# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy go module files (context is packages/apigateway)
COPY go.mod ./
COPY go.sum* ./

# Download dependencies
RUN go mod download
RUN go mod verify

# Copy source code
COPY . .

# Build the application from cmd/apigateway (package main)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o /app/apigateway ./cmd/apigateway

# Runtime stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata wget
WORKDIR /root/

# Copy binary from builder (built to /app/apigateway)
COPY --from=builder /app/apigateway ./

# Grant execute permissions
RUN chmod +x ./apigateway

# Service listens on PORT environment variable
ENV PORT=8080
EXPOSE 8080

CMD ["./apigateway"]
