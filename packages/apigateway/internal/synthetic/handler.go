// Package synthetic contains opt-in fault-injection endpoints used for
// validating that SLO burn-rate alerts and the static-threshold alert
// pipeline actually fire end-to-end. These endpoints are wired into the
// router only when the environment is NOT production (see router.go); in
// production they don't exist on the route table at all.
//
// # Why these exist
//
// You generally don't find out whether an alert pipeline works until
// something genuinely breaks — which is too late. A small set of
// always-available synthetic-fault endpoints lets us rehearse the
// "5xx → burn-rate threshold → email + Slack" path on demand, in dev,
// without modifying any real handlers. The cost is one tiny route per
// fault flavor; the benefit is confidence that the SLO infrastructure
// works the moment we need it.
//
// # How to remove this package cleanly
//
// When this is no longer useful (e.g. the SLO pipeline has been validated
// and the project has matured past needing rehearsals):
//
//  1. Delete this directory: `packages/apigateway/internal/synthetic/`.
//  2. In `packages/apigateway/internal/server/router.go`, remove the
//     `SyntheticFault` field from `AuthenticatedRoutes` and the
//     conditional route registration that references it.
//  3. In `packages/apigateway/cmd/apigateway/main.go`, remove the
//     synthetic handler construction and the `SyntheticFault` field on
//     the `AuthenticatedRoutes` struct literal.
//
// Three small edits across three files. No infrastructure or config
// changes required.
package synthetic

import (
	"log/slog"
	"net/http"

	"github.com/andy-esch/desirelines/packages/shared/apierrors"
)

// Handler bundles all synthetic-fault endpoints. Construct via
// NewHandler; register on the router via router.go's conditional
// (non-production) block.
type Handler struct {
	logger *slog.Logger
}

// NewHandler creates a synthetic-fault handler. The logger is used to
// emit a WARN line every time a synthetic endpoint is hit — useful so
// the rehearsals show up clearly in Cloud Logging without being mistaken
// for real failures.
func NewHandler(logger *slog.Logger) *Handler {
	return &Handler{logger: logger}
}

// Fault5xx always returns HTTP 500. Use to validate apigateway 5xx-based
// alerting (SLO 4 availability fast/slow burn, plus the existing static
// `service_5xx_errors` alert policy).
//
// Usage in dev:
//
//	for i in {1..50}; do
//	  curl -H "Authorization: Bearer <test-token>" \
//	    https://<apigateway-dev-url>/api/v1/__synthetic_5xx__ > /dev/null
//	done
//
// The fast-burn alert (1h window, 14.4× rate) should fire within
// ~10-15 minutes if the wiring is correct. Auto-resolves after the burst
// decays.
func (h *Handler) Fault5xx(w http.ResponseWriter, r *http.Request) {
	h.logger.WarnContext(r.Context(), "synthetic 5xx fault triggered",
		"endpoint", "/v1/__synthetic_5xx__",
	)
	apierrors.WriteError(w, r, apierrors.NewAPIError(
		http.StatusInternalServerError,
		"synthetic fault — this endpoint always returns 500 for SLO alert validation",
	), h.logger)
}
