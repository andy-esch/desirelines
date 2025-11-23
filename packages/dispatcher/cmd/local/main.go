// Package main provides a local development server for testing the Strava webhook dispatcher.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher"
)

func main() {
	log.Println("Starting dispatcher local development server...")

	ctx := context.Background()
	handler, handlerErr := dispatcher.NewHandler(ctx)
	if handlerErr != nil {
		log.Fatalf("Failed to initialize dispatcher handler: %v", handlerErr)
	}

	http.Handle("/", handler)

	port := dispatcher.GetEnvOrDefault("PORT", "8080")
	log.Printf("Server listening on port %s", port)

	// Create server with timeouts for security
	// #nosec G114 - Timeouts are configured below
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Setup graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		<-sigChan

		log.Println("Shutting down gracefully...")

		// Create shutdown context with timeout
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		// Shutdown HTTP server
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}

		// Close handler resources (PubSub client, etc.)
		if err := handler.Close(shutdownCtx); err != nil {
			log.Printf("Handler cleanup error: %v", err)
		}

		log.Println("Shutdown complete")
	}()

	log.Println("Server started. Press Ctrl+C to stop.")
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}
