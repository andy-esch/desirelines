package dispatcher

import (
	"context"
	"net/http"

	"github.com/andy-esch/desirelines/packages/dispatcher"
)

var httpHandler http.Handler

func init() {
	ctx := context.Background()
	handler, err := dispatcher.NewHandler(ctx)
	if err != nil {
		dispatcher.Logger.Error("Failed to initialize dispatcher", "error", err)
		panic(err)
	}
	httpHandler = handler
}

// ActivityDispatcher is the exported function name that matches Terraform's entry_point.
func ActivityDispatcher(w http.ResponseWriter, r *http.Request) {
	httpHandler.ServeHTTP(w, r)
}
