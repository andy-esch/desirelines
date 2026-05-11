package synthetic

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// TestFault5xx_AlwaysReturns500 pins the contract: this endpoint exists
// for SLO alert validation, so it MUST return a 5xx every time. Anything
// else (e.g. silently returning 200 because someone added env-gating in
// the handler) would silently invalidate the synthetic-fault rehearsal.
func TestFault5xx_AlwaysReturns500(t *testing.T) {
	h := NewHandler(gcplog.NewNoOpLogger())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/__synthetic_5xx__", nil)

	h.Fault5xx(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if !strings.Contains(rec.Body.String(), "synthetic fault") {
		t.Errorf("body should mention 'synthetic fault' so anyone hitting it knows what it is; got: %q", rec.Body.String())
	}
}
