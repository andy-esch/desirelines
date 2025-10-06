package apigateway

import (
	"context"
	"log"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway"
)

var httpHandler http.Handler

func init() {
	ctx := context.Background()
	handler, err := apigateway.NewHandler(ctx)
	if err != nil {
		log.Fatalf("Failed to initialize apigateway.NewHandler: %v", err)
	}
	httpHandler = handler
}

// APIGateway is the exported function name that matches Terraform's entry_point.
func APIGateway(w http.ResponseWriter, r *http.Request) {
	httpHandler.ServeHTTP(w, r)
}
