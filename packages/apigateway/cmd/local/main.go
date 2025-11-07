package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/andy-esch/desirelines/packages/apigateway"
)

func main() {
	log.Println("Starting API Gateway local development server...")

	ctx := context.Background()
	handler, err := apigateway.NewHandler(ctx)
	if err != nil {
		log.Fatalf("Failed to initialize API Gateway handler: %v", err)
	}

	http.Handle("/", handler)

	port := getEnvOrDefault("PORT", "8080")
	log.Printf("Server listening on port %s", port)

	// Create server with timeouts for security
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
