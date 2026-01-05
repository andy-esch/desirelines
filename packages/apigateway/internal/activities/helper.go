package activities

import (
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/apierrors"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// respondProtobuf marshals a protobuf message to JSON and sends it.
// Uses protojson for correct handling of protobuf fields (emit unpopulated, use proto names).
func (h *Handler) respondProtobuf(w http.ResponseWriter, r *http.Request, msg any) {
	// We need to type assert to proto.Message to use protojson
	// However, protojson.Marshal takes a proto.Message interface.
	// Since our generated types implement this, we can just pass them.
	// But `msg` is `any`.

	// We'll create a marshaler with EmitUnpopulated: false (default)
	// because our API contract expects omitted fields for optional values (pointers)
	// and we want to respect `omitempty` behavior which protojson handles by default for proto3.
	// We DO want UseProtoNames: true to match snake_case keys in our proto definition.

	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false, 
	}

	pMsg, ok := msg.(proto.Message) 
	if !ok {
		// Fallback for non-proto types (like Activity)
		server.RespondJSON(w, r, http.StatusOK, msg)
		return
	}

	data, err := marshaler.Marshal(pMsg)
	if err != nil {
		logger.Logger.Error("Error marshaling protobuf response", "error", err)
		apiErr := apierrors.NewAPIError(http.StatusInternalServerError, "Internal server error")
		apierrors.WriteError(w, r, apiErr)
		return
	}

	server.RespondRawJSON(w, r, http.StatusOK, data)
}
