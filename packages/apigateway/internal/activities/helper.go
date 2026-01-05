package activities

import (
	"net/http"

	"github.com/andy-esch/desirelines/packages/apigateway/apierrors"
	"github.com/andy-esch/desirelines/packages/apigateway/internal/server"
	"github.com/andy-esch/desirelines/packages/apigateway/logger"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// respondProtobuf marshals a protobuf message to JSON using protojson.
// Uses UseProtoNames: false to emit camelCase keys (default protojson behavior).
func (h *Handler) respondProtobuf(w http.ResponseWriter, r *http.Request, msg proto.Message) {
	if msg == nil {
		server.RespondJSON(w, r, http.StatusOK, nil)
		return
	}

	marshaler := protojson.MarshalOptions{
		UseProtoNames:   false,
		EmitUnpopulated: false,
	}

	data, err := marshaler.Marshal(msg)
	if err != nil {
		logger.Logger.Error("Error marshaling protobuf response", "error", err)
		apiErr := apierrors.NewAPIError(http.StatusInternalServerError, "Internal server error")
		apierrors.WriteError(w, r, apiErr)
		return
	}

	server.RespondRawJSON(w, r, http.StatusOK, data)
}
