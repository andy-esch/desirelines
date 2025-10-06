package main

import (
	"context"
	"log"
	"net/http"
	"os"

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
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
