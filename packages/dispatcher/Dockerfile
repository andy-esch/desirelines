# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy go module files
COPY go.mod ./
COPY go.sum* ./

# Download dependencies
RUN go mod download
RUN go mod verify

# Copy source code
COPY . ./

# Build the application
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o dispatcher ./cmd/local

# Runtime stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata wget
WORKDIR /root/

COPY --from=builder /app/dispatcher ./

# Grant execute permissions
RUN chmod +x ./dispatcher

# Cloud Functions expect the service to run on PORT
ENV PORT=8080
EXPOSE 8080

CMD ["./dispatcher"]
