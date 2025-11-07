package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher"
)

func main() {
	log.Println("Starting dispatcher local development server...")

	ctx := context.Background()
	handler, err := dispatcher.NewHandler(ctx)
	if err != nil {
		log.Fatalf("Failed to initialize dispatcher handler: %v", err)
	}

	http.Handle("/", handler)

	port := getEnvOrDefault("PORT", "8080")
	log.Printf("Server listening on port %s", port)

	// Create server with timeouts for security
	// #nosec G114 - Timeouts are configured below
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           nil,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Fatal(server.ListenAndServe())
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
