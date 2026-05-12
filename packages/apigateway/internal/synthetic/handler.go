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
// When this is no longer useful (e.g. the SLO pipeline + security
// alerts have been validated and the project has matured past needing
// rehearsals):
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
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/andy-esch/desirelines/packages/shared/apierrors"
)

// allowedFaultCodes is the set of HTTP status codes the Fault handler
// will honor via the `?code=` query param. Pinned to codes that map to
// existing alert policies so we don't accidentally synthesize traffic
// for codes nothing is watching:
//
//   - 500: SLO 4 burn-rate + the (non-SLO-services) `service_5xx_errors` alert
//   - 401, 403: `apigateway_auth_failure_surge`
//   - 404: `apigateway_not_found_surge`
//   - 429: `apigateway_rate_limited_surge`
//   - 400: listed for symmetry; note that `dispatcher_bad_request_surge`
//     fires on the DISPATCHER service, not apigateway — this endpoint
//     can't validate that alert. Synthetic 400 here only exercises the
//     same metric pipeline shape.
var allowedFaultCodes = map[int]struct{}{
	400: {},
	401: {},
	403: {},
	404: {},
	429: {},
	500: {},
}

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

// Fault returns the HTTP status code requested via the `?code=N` query
// parameter. Default is 500 when no code is supplied. Unknown codes
// return 422 (deliberately NOT a 4xx-class code in the validation
// allowlist) so a typo during validation doesn't pollute the metrics
// being validated.
//
// Usage in dev:
//
//	# Validate SLO 4 burn-rate (default 500):
//	for i in {1..50}; do
//	  curl -H "Authorization: Bearer <token>" \
//	    https://<apigateway-dev-url>/api/v1/__synthetic_fault__ > /dev/null
//	done
//
//	# Validate apigateway_not_found_surge:
//	for i in {1..200}; do
//	  curl -H "Authorization: Bearer <token>" \
//	    "https://<apigateway-dev-url>/api/v1/__synthetic_fault__?code=404" > /dev/null
//	done
//
// Each alert should fire within ~10-15 minutes of a sustained burst
// crossing the threshold. Auto-resolves after the burst decays.
func (h *Handler) Fault(w http.ResponseWriter, r *http.Request) {
	code := http.StatusInternalServerError
	if param := r.URL.Query().Get("code"); param != "" {
		parsed, err := strconv.Atoi(param)
		if err != nil {
			h.rejectInvalidCode(w, r, param)
			return
		}
		if _, ok := allowedFaultCodes[parsed]; !ok {
			h.rejectInvalidCode(w, r, param)
			return
		}
		code = parsed
	}

	h.logger.WarnContext(r.Context(), "synthetic fault triggered",
		"endpoint", "/v1/__synthetic_fault__",
		"code", code,
	)
	apierrors.WriteError(w, r, apierrors.NewAPIError(
		code,
		fmt.Sprintf("synthetic fault — this endpoint returned %d for alert validation", code),
	), h.logger)
}

// rejectInvalidCode returns 422 (Unprocessable Entity) when the caller
// passes a `code` query param that isn't in `allowedFaultCodes`. 422 is
// chosen specifically because it's outside the security-alert allowlist
// — a burst of malformed validation calls won't trigger an alert and
// pollute the rehearsal.
func (h *Handler) rejectInvalidCode(w http.ResponseWriter, r *http.Request, raw string) {
	h.logger.WarnContext(r.Context(), "synthetic fault rejected: invalid code",
		"endpoint", "/v1/__synthetic_fault__",
		"raw_code", raw,
	)
	apierrors.WriteError(w, r, apierrors.NewAPIError(
		http.StatusUnprocessableEntity,
		fmt.Sprintf("invalid code %q; allowed: 400, 401, 403, 404, 429, 500", raw),
	), h.logger)
}
