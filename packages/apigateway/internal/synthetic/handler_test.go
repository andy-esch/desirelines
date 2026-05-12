package synthetic

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

// TestFault_ReturnsCodeFromQueryParam pins the core contract: each
// allowed code in the validation allowlist is returned as the HTTP
// status code. Anything else (e.g. silently mapping 401→500) would
// silently break the rehearsal — the test cases below would catch it.
func TestFault_ReturnsCodeFromQueryParam(t *testing.T) {
	cases := []int{400, 401, 403, 404, 429, 500}
	h := NewHandler(gcplog.NewNoOpLogger())
	for _, code := range cases {
		t.Run(fmt.Sprintf("code=%d", code), func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(
				http.MethodGet,
				fmt.Sprintf("/v1/__synthetic_fault__?code=%d", code),
				nil,
			)

			h.Fault(rec, req)

			if rec.Code != code {
				t.Errorf("status = %d, want %d", rec.Code, code)
			}
			if !strings.Contains(rec.Body.String(), "synthetic fault") {
				t.Errorf("body should mention 'synthetic fault' so anyone hitting it knows what it is; got: %q", rec.Body.String())
			}
		})
	}
}

// TestFault_DefaultsTo500 confirms backward-compatible behavior for
// callers who hit the endpoint with no query param. Defaults preserve
// the SLO 4 validation use case that this endpoint originally served.
func TestFault_DefaultsTo500(t *testing.T) {
	h := NewHandler(gcplog.NewNoOpLogger())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/__synthetic_fault__", nil)

	h.Fault(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("default status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

// TestFault_RejectsInvalidCode pins that invalid codes return 422
// rather than echoing the bad value or defaulting to 500. 422 was
// chosen specifically to land outside the security-alert allowlist so
// a typo during validation doesn't pollute the very metrics being
// validated.
func TestFault_RejectsInvalidCode(t *testing.T) {
	cases := []string{
		"not-a-number", // not parseable
		"418",          // parseable but not in allowlist (good ol' I'm a teapot)
		"200",          // success-class — would be highly confusing in a fault endpoint
		"301",          // redirect — not in allowlist
		"-1",           // negative
		"99999",        // out of HTTP range
	}
	h := NewHandler(gcplog.NewNoOpLogger())
	for _, code := range cases {
		t.Run(fmt.Sprintf("code=%q", code), func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(
				http.MethodGet,
				fmt.Sprintf("/v1/__synthetic_fault__?code=%s", code),
				nil,
			)

			h.Fault(rec, req)

			if rec.Code != http.StatusUnprocessableEntity {
				t.Errorf("status = %d, want %d (422 for invalid code so rehearsal metrics aren't polluted)",
					rec.Code, http.StatusUnprocessableEntity)
			}
			if !strings.Contains(rec.Body.String(), "invalid code") {
				t.Errorf("body should mention 'invalid code'; got: %q", rec.Body.String())
			}
		})
	}
}
