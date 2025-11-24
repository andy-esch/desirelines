// Package main provides a local development server for testing the API Gateway.
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
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

	// Create server with configured handler and timeouts for security
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Start server in goroutine to allow graceful shutdown
	go func() {
		logger.Logger.Info("Server listening", "port", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Logger.Error("Server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Logger.Info("Shutting down server...")

	// Give server 30 seconds to finish in-flight requests
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Logger.Error("Server forced to shutdown", "error", err)
		os.Exit(1)
	}

	logger.Logger.Info("Server exited gracefully")
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
