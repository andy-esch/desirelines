package dispatcher

import (
	"context"
	"log"
	"net/http"

	"github.com/andy-esch/desirelines/packages/dispatcher"
)

var httpHandler http.Handler

func init() {
	ctx := context.Background()
	handler, err := dispatcher.NewHandler(ctx)
	if err != nil {
		log.Fatalf("Failed to initialize dispatcher.NewHandler: %v", err)
	}
	httpHandler = handler
}

// ActivityDispatcher is the exported function name that matches Terraform's entry_point.
func ActivityDispatcher(w http.ResponseWriter, r *http.Request) {
	httpHandler.ServeHTTP(w, r)
}
