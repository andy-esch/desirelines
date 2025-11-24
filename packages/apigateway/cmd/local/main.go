// Package main provides a local development server for testing the API Gateway.
package main

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
)

func main() {
	logger.Logger.Info("Starting API Gateway local development server")

	ctx := context.Background()
	handler, err := apigateway.NewHandler(ctx)
	if err != nil {
		logger.Logger.Error("Failed to initialize API Gateway handler", "error", err)
		os.Exit(1)
	}

	http.Handle("/", handler)

	port := getEnvOrDefault("PORT", "8080")
	logger.Logger.Info("Server listening", "port", port)

	// Create server with configured handler and timeouts for security
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Use different variable name to avoid shadowing err from line 18
	serverErr := server.ListenAndServe()
	if serverErr != nil {
		logger.Logger.Error("Server failed", "error", serverErr)
		os.Exit(1)
	}
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
