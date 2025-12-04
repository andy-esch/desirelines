package apigateway

import (
	"context"
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
)

var httpHandler http.Handler

func init() {
	ctx := context.Background()
	handler, err := apigateway.NewHandler(ctx)
	if err != nil {
		logger.Logger.Error("Failed to initialize apigateway.NewHandler", "error", err)
		panic(err) // Fatal error during initialization
	}
	httpHandler = handler
}

// APIGateway is the exported function name that matches Terraform's entry_point.
func APIGateway(w http.ResponseWriter, r *http.Request) {
	httpHandler.ServeHTTP(w, r)
}
