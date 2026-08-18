package httpadapter

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

// Security invariants for the public, unauthenticated webhook endpoint.
//
// Two kinds of test live here, and the difference matters when one fails:
//
//   - Invariant tests lock in behavior that is correct today. A failure is a
//     regression: something has widened the endpoint's trust or its blast radius.
//   - Characterization tests, named TestSecurity_Current_*, pin down behavior
//     that is NOT correct today — the accepted-risk consequences of Strava
//     shipping no payload authentication. They exist so a fix cannot land
//     silently: whoever adds authenticity or replay defense must come here and
//     rewrite the expectation deliberately. Read their doc comments before
//     "fixing" a failure by loosening the assertion.
//
// Everything here runs against fakes. Nothing in this file talks to Strava,
// Firestore, Pub/Sub, or any deployed service.

// securityRig is a handler wired to recording fakes, with an allowlist that
// denies by default — the attacker is not a user of this environment.
type securityRig struct {
	router  http.Handler
	tokens  *portstest.MockTokenStore
	deauth  *portstest.MockPublisher
	primary *portstest.MockPublisher
	strava  *portstest.MockStravaClient
	allow   *portstest.MockAllowlist
}

func newSecurityRig(t *testing.T, allowed bool) *securityRig {
	t.Helper()
	rig := &securityRig{
		tokens:  &portstest.MockTokenStore{},
		deauth:  &portstest.MockPublisher{},
		primary: &portstest.MockPublisher{},
		strava: &portstest.MockStravaClient{
			FetchResult:  []byte(`{"id":1}`),
			VerifyStatus: ports.GrantActive,
		},
		allow: &portstest.MockAllowlist{Allowed: allowed},
	}
	h := NewHandler(rig.primary, rig.deauth,
		&portstest.MockSecretProvider{VerifyToken: "correct-verify-token", SubscriptionID: testSubscriptionID},
		rig.strava, rig.tokens, rig.allow, gcplog.NewNoOpLogger(), &HandlerConfig{
			WebhookCallbackCapability: testWebhookCapability,
		})
	rig.router = h.RegisterRoutes()
	return rig
}

func (r *securityRig) post(body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, testWebhookPath, bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", contentTypeJSON)
	w := httptest.NewRecorder()
	r.router.ServeHTTP(w, req)
	return w
}

// victimOwnerID stands in for an athlete the attacker does not control. Nothing
// about the attack depends on its value — that is the point of the findings
// below — so the tests share one.
const victimOwnerID = 424242

// deauthBody builds the minimal athlete-delete deauthorization payload: six
// fields, no signature, no secret beyond subscription_id.
func deauthBody(subscriptionID int) string {
	return fmt.Sprintf(
		`{"aspect_type":"delete","object_type":"athlete","object_id":%d,"owner_id":%d,"event_time":1,"subscription_id":%d}`,
		victimOwnerID, victimOwnerID, subscriptionID)
}

// TestSecurity_SubscriptionMismatchHasNoSideEffects is the load-bearing
// invariant of the whole endpoint. subscription_id is not a MAC and cannot
// authenticate a payload (see TestSecurity_ForgedDeauthWithActiveGrantIsRejected), but
// it is the only gate there is, so nothing that fails it may reach Firestore,
// Strava, or Pub/Sub. A regression here removes the last barrier in front of
// the deauthorization path.
func TestSecurity_SubscriptionMismatchHasNoSideEffects(t *testing.T) {
	for _, subscriptionID := range []int{0, 1, testSubscriptionID - 1, testSubscriptionID + 1, 1 << 30} {
		t.Run(fmt.Sprintf("subscription_%d", subscriptionID), func(t *testing.T) {
			rig := newSecurityRig(t, true)
			w := rig.post(deauthBody(subscriptionID))

			if w.Code == http.StatusOK {
				t.Errorf("status = 200 for subscription_id %d, want a rejection", subscriptionID)
			}
			if got := rig.tokens.DeletedCount(); got != 0 {
				t.Errorf("DeleteTokens called %d times, want 0", got)
			}
			if got := len(rig.deauth.Published); got != 0 {
				t.Errorf("deauth publishes = %d, want 0", got)
			}
			if got := rig.strava.FetchedCount(); got != 0 {
				t.Errorf("Strava fetches = %d, want 0", got)
			}
			// The grant check is a Strava round-trip too: a middleware-order
			// regression that ran it before the subscription gate would contact
			// Strava for unauthenticated callers without any other assertion here
			// catching it.
			if got := rig.strava.VerifyCalledCount(); got != 0 {
				t.Errorf("grant verifications = %d, want 0", got)
			}
			if got := rig.allow.CalledCount(); got != 0 {
				t.Errorf("allowlist reads = %d, want 0", got)
			}
		})
	}
}

// TestSecurity_RejectionsDoNotEchoSecrets asserts no rejection path returns the
// configured verify token or subscription ID to the caller. The endpoint is
// public, so an error body is an oracle: echoing the expected value would turn
// the one gate the endpoint has into a self-service lookup.
func TestSecurity_RejectionsDoNotEchoSecrets(t *testing.T) {
	rig := newSecurityRig(t, true)

	bodies := make([]string, 0, 4)
	bodies = append(bodies,
		rig.post(deauthBody(testSubscriptionID+1)).Body.String(),
		rig.post(`{"aspect_type":"bogus","object_type":"athlete","object_id":1,"owner_id":1,"event_time":1,"subscription_id":1}`).Body.String(),
		rig.post(`{not json`).Body.String(),
	)

	req := httptest.NewRequest(http.MethodGet, testWebhookPath+"?hub.mode=subscribe&hub.challenge=c&hub.verify_token=wrong", nil)
	w := httptest.NewRecorder()
	rig.router.ServeHTTP(w, req)
	bodies = append(bodies, w.Body.String())

	for i, body := range bodies {
		if strings.Contains(body, "correct-verify-token") {
			t.Errorf("response %d leaked the verify token: %s", i, body)
		}
		if strings.Contains(body, strconvItoa(testSubscriptionID)) {
			t.Errorf("response %d leaked the subscription ID: %s", i, body)
		}
	}
}

func strconvItoa(i int) string { return fmt.Sprintf("%d", i) }

// TestSecurity_VerificationRequiresNonEmptyToken guards the case where a
// SecretProvider hands back ("", nil). subtle.ConstantTimeCompare returns 1 for
// two empty slices, so without the handler's explicit empty check any caller
// could pass verification and have hub.challenge echoed back — which is how a
// third party would steal the subscription by re-registering it.
func TestSecurity_VerificationRequiresNonEmptyToken(t *testing.T) {
	h := NewHandler(&portstest.MockPublisher{}, &portstest.MockPublisher{},
		&portstest.MockSecretProvider{VerifyToken: "", SubscriptionID: testSubscriptionID},
		&portstest.MockStravaClient{}, &portstest.MockTokenStore{},
		portstest.NewAllowAllMockAllowlist(), gcplog.NewNoOpLogger(), nil)
	router := h.RegisterRoutes()

	req := httptest.NewRequest(http.MethodGet, testWebhookPath+"?hub.mode=subscribe&hub.challenge=pwned&hub.verify_token=", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusOK {
		t.Fatalf("empty configured verify token accepted an empty caller token (status 200) — challenge echo: %s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "pwned") {
		t.Errorf("hub.challenge echoed without a valid token: %s", w.Body.String())
	}
}

// TestSecurity_PublicSurfaceIsMinimal pins the reachable route set. The service
// runs at max_instance_count=1 with request concurrency 1, so every additional
// reachable path is both attack surface and a way to occupy the single slot.
// Debug, profiling, and metrics endpoints must never become routable.
func TestSecurity_PublicSurfaceIsMinimal(t *testing.T) {
	rig := newSecurityRig(t, true)
	body := deauthBody(testSubscriptionID)

	cases := []struct {
		name, method, path string
		wantStatus         int
	}{
		{"canonical webhook post", http.MethodPost, testWebhookPath, http.StatusOK},
		{"retired plain route not routed", http.MethodPost, "/webhook", http.StatusNotFound},
		{"trailing slash not routed", http.MethodPost, "/webhook/", http.StatusNotFound},
		{"double slash not routed", http.MethodPost, "//webhook", http.StatusNotFound},
		{"dot segments not collapsed into a match", http.MethodPost, "/foo/../webhook", http.StatusNotFound},
		{"percent-encoded path not routed", http.MethodPost, "/%77ebhook", http.StatusNotFound},
		{"uppercase path not routed", http.MethodPost, "/WEBHOOK", http.StatusNotFound},
		{"put rejected", http.MethodPut, testWebhookPath, http.StatusMethodNotAllowed},
		{"patch rejected", http.MethodPatch, testWebhookPath, http.StatusMethodNotAllowed},
		{"delete rejected", http.MethodDelete, testWebhookPath, http.StatusMethodNotAllowed},
		{"pprof absent", http.MethodGet, "/debug/pprof/", http.StatusNotFound},
		{"metrics absent", http.MethodGet, "/metrics", http.StatusNotFound},
		{"env absent", http.MethodGet, "/debug/vars", http.StatusNotFound},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(body))
			req.Header.Set("Content-Type", contentTypeJSON)
			w := httptest.NewRecorder()
			rig.router.ServeHTTP(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("%s %s = %d, want %d", tc.method, tc.path, w.Code, tc.wantStatus)
			}
		})
	}
}

// TestSecurity_ContentTypeIsEnforced keeps the JSON body reader behind a
// Content-Type check. Media types are case-insensitive per RFC 9110, so
// APPLICATION/JSON is legitimately accepted; anything that is not JSON must be
// refused before the body is read.
func TestSecurity_ContentTypeIsEnforced(t *testing.T) {
	cases := []struct {
		ctype      string
		wantStatus int
	}{
		{"application/json", http.StatusOK},
		{"application/json; charset=utf-8", http.StatusOK},
		{"APPLICATION/JSON", http.StatusOK},
		{"", http.StatusUnsupportedMediaType},
		{"text/plain", http.StatusUnsupportedMediaType},
		{"application/x-www-form-urlencoded", http.StatusUnsupportedMediaType},
		{"application/json-patch+json", http.StatusUnsupportedMediaType},
		{"multipart/form-data; boundary=x", http.StatusUnsupportedMediaType},
	}

	for _, tc := range cases {
		t.Run(tc.ctype, func(t *testing.T) {
			rig := newSecurityRig(t, true)
			req := httptest.NewRequest(http.MethodPost, testWebhookPath,
				strings.NewReader(deauthBody(testSubscriptionID)))
			if tc.ctype != "" {
				req.Header.Set("Content-Type", tc.ctype)
			}
			w := httptest.NewRecorder()
			rig.router.ServeHTTP(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("Content-Type %q = %d, want %d", tc.ctype, w.Code, tc.wantStatus)
			}
		})
	}
}

// TestSecurity_BodySizeIsCapped keeps the 1MB MaxBytesReader in front of
// io.ReadAll. The container has a 128Mi memory limit, so an uncapped read is a
// one-request OOM.
func TestSecurity_BodySizeIsCapped(t *testing.T) {
	rig := newSecurityRig(t, true)

	small := `{"aspect_type":"delete","object_type":"athlete","object_id":1,"owner_id":9,"event_time":1,"subscription_id":123,"pad":"` +
		strings.Repeat("A", 1024) + `"}`
	if w := rig.post(small); w.Code != http.StatusOK {
		t.Errorf("1KB body = %d, want 200", w.Code)
	}

	oversized := `{"aspect_type":"delete","object_type":"athlete","object_id":1,"owner_id":9,"event_time":1,"subscription_id":123,"pad":"` +
		strings.Repeat("A", 1<<20) + `"}`
	if w := rig.post(oversized); w.Code != http.StatusBadRequest {
		t.Errorf("oversized body = %d, want 400", w.Code)
	}
}

// TestSecurity_ForgedDeauthWithActiveGrantIsRejected is the regression for the
// endpoint's central weakness: Strava signs nothing, so a deauthorization is an
// unauthenticated assertion, and the handler must not act on it unless the
// athlete's grant is actually revoked.
//
// Each payload shape below was accepted before the fix — deleting the victim's
// tokens and publishing to the deletion topic even against a denying allowlist.
// The fix confirms the grant first (VerifyGrant); the default rig models a
// still-live grant, so every shape must now be acknowledged with zero side
// effects. The subscription gate is still passed here — this asserts the second
// line of defense, not the first.
func TestSecurity_ForgedDeauthWithActiveGrantIsRejected(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"athlete delete", deauthBody(testSubscriptionID)},
		{"athlete update, documented string form",
			fmt.Sprintf(`{"aspect_type":"update","object_type":"athlete","object_id":1,"owner_id":%d,"event_time":1,"subscription_id":%d,"updates":{"authorized":"false"}}`, victimOwnerID, testSubscriptionID)},
		{"athlete update, bare boolean form",
			fmt.Sprintf(`{"aspect_type":"update","object_type":"athlete","object_id":1,"owner_id":%d,"event_time":1,"subscription_id":%d,"updates":{"authorized":false}}`, victimOwnerID, testSubscriptionID)},
		{"event_time in 1970",
			fmt.Sprintf(`{"aspect_type":"delete","object_type":"athlete","object_id":1,"owner_id":%d,"event_time":1,"subscription_id":%d}`, victimOwnerID, testSubscriptionID)},
		{"event_time in the year 5138",
			fmt.Sprintf(`{"aspect_type":"delete","object_type":"athlete","object_id":1,"owner_id":%d,"event_time":99999999999,"subscription_id":%d}`, victimOwnerID, testSubscriptionID)},
		// encoding/json matches struct tags case-insensitively, so any external
		// filter that string-matches the documented lowercase field names is
		// trivially bypassed while the handler still parses the payload.
		{"case-variant field names",
			fmt.Sprintf(`{"ASPECT_TYPE":"delete","Object_Type":"athlete","OBJECT_ID":1,"OwNeR_Id":%d,"Event_Time":1,"SubScription_ID":%d}`, victimOwnerID, testSubscriptionID)},
		{"unknown fields ignored",
			fmt.Sprintf(`{"aspect_type":"delete","object_type":"athlete","object_id":1,"owner_id":%d,"event_time":1,"subscription_id":%d,"junk":{"a":[1,2]}}`, victimOwnerID, testSubscriptionID)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rig := newSecurityRig(t, false)
			// Default rig: grant is still live, so this
			// "deauthorization" is spurious/forged.
			w := rig.post(tc.body)

			// Acknowledged so the sender stops retrying...
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (forged deauth is acknowledged, not errored)", w.Code)
			}
			// ...but nothing destructive happens.
			if got := rig.tokens.DeletedCount(); got != 0 {
				t.Errorf("DeleteTokens called %d times, want 0 — a forged deauth deleted tokens", got)
			}
			if got := len(rig.deauth.Published); got != 0 {
				t.Errorf("deauth publishes = %d, want 0 — a forged deauth reached the deletion topic", got)
			}
			// The gate must actually have run (not been skipped by some earlier
			// short-circuit): the grant was checked exactly once for the victim.
			if got := rig.strava.VerifyCalledOwnerIDs; len(got) != 1 || got[0] != victimOwnerID {
				t.Errorf("VerifyGrant calls = %v, want [%d]", got, victimOwnerID)
			}
		})
	}
}

// TestSecurity_GenuineDeauthWithRevokedGrantIsProcessed is the other half of the
// fix: a confirmed-revoked grant must still clean up, including for an athlete
// the allowlist would reject (the former-member case the deauth path exists for).
func TestSecurity_GenuineDeauthWithRevokedGrantIsProcessed(t *testing.T) {
	rig := newSecurityRig(t, false)              // allowlist denies; deauth must proceed anyway
	rig.strava.VerifyStatus = ports.GrantRevoked // grant confirmed dead

	if w := rig.post(deauthBody(testSubscriptionID)); w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if got := rig.tokens.DeletedAthleteIDs; len(got) != 1 || got[0] != victimOwnerID {
		t.Errorf("DeleteTokens called with %v, want [%d]", got, victimOwnerID)
	}
	if got := len(rig.deauth.Published); got != 1 {
		t.Errorf("deauth publishes = %d, want 1", got)
	}
	if got := rig.allow.CalledCount(); got != 0 {
		t.Errorf("allowlist reads = %d, want 0 (deauth bypasses the allowlist by design)", got)
	}
}

// TestSecurity_DeauthWithNoStoredTokensIsDropped covers the confirmation gate's
// no-tokens branch: an athlete with no stored credentials cannot be confirmed and
// has nothing in the token store to purge, so the event is acknowledged without
// deleting or publishing. This is the branch that protects an allowlisted-but-
// unauthenticated athlete's footprint from a forged deauth.
func TestSecurity_DeauthWithNoStoredTokensIsDropped(t *testing.T) {
	rig := newSecurityRig(t, false)
	rig.strava.VerifyErr = ports.ErrTokenNotFound

	if w := rig.post(deauthBody(testSubscriptionID)); w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if got := rig.tokens.DeletedCount(); got != 0 {
		t.Errorf("DeleteTokens called %d times, want 0", got)
	}
	if got := len(rig.deauth.Published); got != 0 {
		t.Errorf("deauth publishes = %d, want 0", got)
	}
}

// TestSecurity_DeauthConfirmationErrorFailsClosed covers the transient-error
// branch: when Strava cannot be reached to confirm, the handler must NOT delete —
// it returns 500 so Strava redelivers, and a forgery cannot force deletion by
// inducing an error.
func TestSecurity_DeauthConfirmationErrorFailsClosed(t *testing.T) {
	rig := newSecurityRig(t, false)
	rig.strava.VerifyErr = errors.New("strava unreachable")

	w := rig.post(deauthBody(testSubscriptionID))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (fail closed for retry)", w.Code)
	}
	if got := rig.tokens.DeletedCount(); got != 0 {
		t.Errorf("DeleteTokens called %d times, want 0 — deletion on an unconfirmed deauth", got)
	}
	if got := len(rig.deauth.Published); got != 0 {
		t.Errorf("deauth publishes = %d, want 0 — publish on an unconfirmed deauth", got)
	}
}

// newStatefulDeauthRig wires a handler whose grant verification tracks the token
// store, the way the real client does: a stored token verifies as GrantRevoked
// (grant dead but the token record still present — the genuine-deauth state), and
// once that token is deleted the same owner verifies as GrantUnknown +
// ErrTokenNotFound. Modeling that transition is what makes deauth replay and
// publish-retry behavior realistic instead of the earlier fake that stayed
// "revoked" forever and hid the publish-before-delete ordering.
func newStatefulDeauthRig(t *testing.T) *securityRig {
	t.Helper()
	tokens := &portstest.MockTokenStore{
		Tokens:        map[int64]*stravatoken.Data{victimOwnerID: {AccessToken: "a", RefreshToken: "r"}},
		DeleteRemoves: true,
	}
	rig := &securityRig{
		tokens:  tokens,
		deauth:  &portstest.MockPublisher{},
		primary: &portstest.MockPublisher{},
		strava: &portstest.MockStravaClient{
			VerifyFunc: func(ctx context.Context, ownerID int64) (ports.GrantStatus, error) {
				if _, err := tokens.GetTokens(ctx, ownerID); err != nil {
					// %w keeps ErrTokenNotFound matchable once the token is deleted.
					return ports.GrantUnknown, fmt.Errorf("verify grant: %w", err)
				}
				return ports.GrantRevoked, nil
			},
		},
		allow: &portstest.MockAllowlist{Allowed: false},
	}
	h := NewHandler(rig.primary, rig.deauth,
		&portstest.MockSecretProvider{VerifyToken: "correct-verify-token", SubscriptionID: testSubscriptionID},
		rig.strava, rig.tokens, rig.allow, gcplog.NewNoOpLogger(), &HandlerConfig{
			WebhookCallbackCapability: testWebhookCapability,
		})
	rig.router = h.RegisterRoutes()
	return rig
}

// TestSecurity_GenuineDeauthReplayIsDedupedByTokenDeletion replaces the earlier
// unrealistic replay characterization. With a fake whose grant status tracks the
// token store, a genuine deauthorization's downstream work runs at most once: the
// first delivery publishes and deletes the token, and every replay after that
// finds no token to confirm against and is dropped.
//
// This dedup is incidental to the forged-deauth fix (token deletion + the
// no-tokens drop), not a freshness guarantee. It relies on the service's
// single-request concurrency — replays are serialized, so each sees the
// post-delete state — and does nothing for the pre-deletion window or non-deauth
// events. General replay/freshness is tracked as its own remediation task.
func TestSecurity_GenuineDeauthReplayIsDedupedByTokenDeletion(t *testing.T) {
	rig := newStatefulDeauthRig(t)
	body := deauthBody(testSubscriptionID)

	for i := range 5 {
		if w := rig.post(body); w.Code != http.StatusOK {
			t.Fatalf("replay %d: status = %d, want 200", i, w.Code)
		}
	}
	if got := rig.tokens.DeletedCount(); got != 1 {
		t.Errorf("DeleteTokens calls = %d, want 1 (replays after the first find no token)", got)
	}
	if got := len(rig.deauth.Published); got != 1 {
		t.Errorf("deauth publishes = %d, want 1", got)
	}
}

// TestSecurity_DeauthPublishFailureRetainsTokenForRetry is the regression for the
// publish-before-delete ordering. If the durable Pub/Sub handoff fails, the token
// must be retained so Strava's redelivery can re-confirm and retry the publish. A
// delete-then-publish ordering would strand the downstream deletion: the retry
// would find no token, drop as unconfirmable, and never publish — the exact
// permanent-loss path the review caught.
func TestSecurity_DeauthPublishFailureRetainsTokenForRetry(t *testing.T) {
	rig := newStatefulDeauthRig(t)
	rig.deauth.FailFirstN = 1 // first publish fails, the redelivery's publish succeeds
	body := deauthBody(testSubscriptionID)

	// Delivery 1: grant confirmed, publish fails → 500, token retained.
	if w := rig.post(body); w.Code != http.StatusInternalServerError {
		t.Fatalf("first delivery: status = %d, want 500 (publish failed)", w.Code)
	}
	if got := rig.tokens.DeletedCount(); got != 0 {
		t.Fatalf("token deleted despite a failed publish (%d) — a retry would then strand the deletion", got)
	}

	// Delivery 2 (Strava redelivery): token still present → re-confirmed →
	// publish succeeds → token deleted. No permanent loss.
	if w := rig.post(body); w.Code != http.StatusOK {
		t.Fatalf("redelivery: status = %d, want 200", w.Code)
	}
	if got := len(rig.deauth.Published); got != 1 {
		t.Errorf("deauth publishes = %d, want 1 (the successful redelivery)", got)
	}
	if got := rig.tokens.DeletedCount(); got != 1 {
		t.Errorf("DeleteTokens calls = %d, want 1", got)
	}
}

// TestSecurity_SubscriptionIDEnumerationRequiresCallbackCapability pins the
// closure of the subscription-ID enumeration oracle: without the callback
// capability, a probe cannot reach JSON parsing or the subscription-ID
// comparison. Correct and incorrect IDs therefore have the same generic
// response and no downstream side effects.
func TestSecurity_SubscriptionIDEnumerationRequiresCallbackCapability(t *testing.T) {
	rig := newSecurityRig(t, false)
	h := NewHandler(rig.primary, rig.deauth,
		&portstest.MockSecretProvider{VerifyToken: "correct-verify-token", SubscriptionID: testSubscriptionID},
		rig.strava, rig.tokens, rig.allow, gcplog.NewNoOpLogger(), &HandlerConfig{
			WebhookCallbackCapability: testWebhookCapability,
		})
	rig.router = h.RegisterRoutes()

	probe := func(subscriptionID int) *httptest.ResponseRecorder {
		body := fmt.Sprintf(
			`{"aspect_type":"create","object_type":"athlete","object_id":1,"owner_id":9,"event_time":1,"subscription_id":%d}`,
			subscriptionID)
		req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
		req.Header.Set("Content-Type", contentTypeJSON)
		w := httptest.NewRecorder()
		rig.router.ServeHTTP(w, req)
		if rig.tokens.DeletedCount() != 0 || len(rig.deauth.Published) != 0 || len(rig.primary.Published) != 0 || rig.strava.VerifyCalledCount() != 0 {
			t.Fatalf("probe for subscription_id %d left side effects", subscriptionID)
		}
		return w
	}

	hit := probe(testSubscriptionID)
	miss := probe(testSubscriptionID + 1)

	if hit.Code != http.StatusNotFound || miss.Code != http.StatusNotFound {
		t.Errorf("got hit=%d miss=%d, want uniform 404/404", hit.Code, miss.Code)
	}
	if hit.Body.String() != miss.Body.String() {
		t.Errorf("correct and incorrect subscription IDs produced distinct bodies: %q vs %q", hit.Body.String(), miss.Body.String())
	}
}

// TestSecurity_Current_DeauthDetectionIsCaseSensitive characterizes a gap in
// the opposite direction from the forgery findings: a real deauthorization that
// Strava encodes with different casing is silently acknowledged and the
// athlete's tokens are retained.
//
// CoerceToString normalizes JSON *types* (string, bool, number) but neither the
// `updates` map key nor the value is case-folded, so {"Authorized":"false"} and
// {"authorized":"False"} both read as "not a deauthorization". Strava documents
// only the lowercase string form, so this is latent rather than active — but the
// bare-boolean variant already proved the documented form is not the only one
// shipped, and the failure mode here is retaining credentials the user revoked,
// against the 48-hour deletion requirement in the Strava API Agreement.
func TestSecurity_DeauthDetectionToleratesSpellingVariants(t *testing.T) {
	// Every one of these means "the athlete revoked the grant". Each was a
	// silent miss before 2026-08-17: the event was acked 200, nothing was
	// counted, and the revoked athlete's tokens stayed in Firestore.
	cases := []struct{ name, updates string }{
		{"documented form", `{"authorized":"false"}`},
		{"bare boolean", `{"authorized":false}`},
		{"capitalized key", `{"Authorized":"false"}`},
		{"uppercase key", `{"AUTHORIZED":"false"}`},
		{"capitalized value", `{"authorized":"False"}`},
		{"uppercase value", `{"authorized":"FALSE"}`},
		{"padded value", `{"authorized":" false "}`},
		{"numeric zero", `{"authorized":0}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rig := newSecurityRig(t, true)
			// Grant genuinely revoked, so a detected deauth passes confirmation
			// and deletes. That makes deletion the observable proof of detection.
			rig.strava.VerifyStatus = ports.GrantRevoked
			rig.tokens.Tokens = map[int64]*stravatoken.Data{
				victimOwnerID: {AccessToken: "a", RefreshToken: "r"},
			}

			w := rig.post(fmt.Sprintf(
				`{"aspect_type":"update","object_type":"athlete","object_id":1,"owner_id":%d,"event_time":1,"subscription_id":%d,"updates":%s}`,
				victimOwnerID, testSubscriptionID, tc.updates))

			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", w.Code)
			}
			if got := len(rig.deauth.Published); got != 1 {
				t.Errorf("deauth publishes = %d, want 1 — the revocation was not detected", got)
			}
			if got := rig.tokens.DeletedCount(); got != 1 {
				t.Errorf("DeleteTokens calls = %d, want 1 — revoked credentials were retained", got)
			}
		})
	}
}

// TestSecurity_DeauthDetectionIgnoresNonRevocations is the other side of the
// tolerance added above: matching loosely must not turn an ordinary athlete
// update into a deletion. The grant check would refuse these anyway, but the
// detector should not be asking it in the first place.
func TestSecurity_DeauthDetectionIgnoresNonRevocations(t *testing.T) {
	cases := []struct{ name, updates string }{
		{"still authorized", `{"authorized":"true"}`},
		{"bare true", `{"authorized":true}`},
		{"numeric one", `{"authorized":1}`},
		{"unrelated key", `{"weight":"75.0"}`},
		{"key that merely contains authorized", `{"deauthorized_at":"false"}`},
		{"empty updates", `{}`},
		{"nested object value", `{"authorized":{"nested":false}}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rig := newSecurityRig(t, true)
			rig.strava.VerifyStatus = ports.GrantRevoked

			w := rig.post(fmt.Sprintf(
				`{"aspect_type":"update","object_type":"athlete","object_id":1,"owner_id":%d,"event_time":1,"subscription_id":%d,"updates":%s}`,
				victimOwnerID, testSubscriptionID, tc.updates))

			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", w.Code)
			}
			if got := len(rig.deauth.Published); got != 0 {
				t.Errorf("deauth publishes = %d, want 0 — a non-revocation was treated as one", got)
			}
			if got := rig.tokens.DeletedCount(); got != 0 {
				t.Errorf("DeleteTokens calls = %d, want 0", got)
			}
		})
	}
}

// FuzzWebhookEndpoint drives the full parse → validate → route path with
// arbitrary bodies. The invariants: the handler never panics (chi's Recoverer
// would convert a panic into a 500, but on a single-slot service a panicking
// path is still a denial-of-service primitive), and no request that fails the
// subscription gate may reach Firestore, Strava, or Pub/Sub.
func FuzzWebhookEndpoint(f *testing.F) {
	f.Add(deauthBody(testSubscriptionID))
	f.Add(`{"aspect_type":"create","object_type":"activity","object_id":1,"owner_id":1,"event_time":1,"subscription_id":123}`)
	f.Add(`{"aspect_type":"update","object_type":"athlete","object_id":1,"owner_id":1,"event_time":1,"subscription_id":123,"updates":{"authorized":false}}`)
	f.Add(`{"updates":null,"subscription_id":123}`)
	f.Add(`{"subscription_id":9999999999999999999999}`)
	f.Add(`{"event_time":-9223372036854775808,"object_id":-1,"owner_id":-1,"subscription_id":123,"aspect_type":"delete","object_type":"athlete"}`)
	f.Add(`{"updates":{"authorized":{"nested":true}}}`)
	f.Add(`[]`)
	f.Add(`null`)
	f.Add("")
	f.Add(`{"aspect_type":"delete","object_type":"athlete","object_id":1,"owner_id":1,"event_time":1,"subscription_id":123,"updates":"\ud800"}`)

	f.Fuzz(func(t *testing.T, body string) {
		rig := newSecurityRig(t, true)
		w := rig.post(body) // a panic inside fails the fuzz run

		touchedStores := rig.tokens.DeletedCount() > 0 ||
			len(rig.deauth.Published) > 0 ||
			len(rig.primary.Published) > 0 ||
			rig.strava.FetchedCount() > 0 ||
			rig.strava.VerifyCalledCount() > 0

		if w.Code == http.StatusUnauthorized && touchedStores {
			t.Fatalf("subscription gate rejected the request but downstream work still ran: body=%q", body)
		}
	})
}

// attackerOwnerID is an allowlisted athlete under the attacker's control. The
// cross-owner question is what happens when they name someone else's object.
const attackerOwnerID = 515151

// activityBody builds an activity create event naming an arbitrary owner/object
// pair, so a test can separate the two identities the handler treats differently.
func activityBody(ownerID, objectID int64) string {
	return fmt.Sprintf(
		`{"aspect_type":"create","object_type":"activity","object_id":%d,"owner_id":%d,"event_time":1,"subscription_id":%d}`,
		objectID, ownerID, testSubscriptionID)
}

// TestSecurity_CrossOwnerEventIsScopedToTheClaimedOwner pins which of the two
// caller-supplied identities each downstream decision uses. The allowlist gate
// reads owner_id, but the Strava fetch is FetchActivity(ownerID, objectID) — so a
// caller can pair an allowlisted owner with an object that owner does not own.
//
// The invariant that matters: the owner's own token is what fetches, so Strava is
// the authority that refuses a cross-owner read. The dispatcher must not
// substitute the object's owner, and must not publish anything when the fetch is
// refused.
func TestSecurity_CrossOwnerEventIsScopedToTheClaimedOwner(t *testing.T) {
	rig := newSecurityRig(t, true)
	// Strava refuses the cross-owner read, which is the realistic response when
	// attackerOwnerID's token asks for an activity belonging to victimOwnerID.
	rig.strava.FetchErr = errors.New("strava: 404 not found")

	w := rig.post(activityBody(attackerOwnerID, victimOwnerID))

	// The allowlist is consulted for the claimed owner and nobody else. If this
	// ever reads the object's owner, a non-allowlisted athlete's object id would
	// become a way to probe allowlist membership.
	if got := rig.allow.CalledWith; len(got) != 1 || got[0] != strconv.Itoa(attackerOwnerID) {
		t.Errorf("allowlist consulted with %v, want exactly [%d]", got, attackerOwnerID)
	}

	// The fetch is attempted with the claimed owner's credentials against the
	// named object — never the object owner's credentials.
	if got := rig.strava.FetchedOwnerIDs; len(got) != 1 || got[0] != attackerOwnerID {
		t.Errorf("fetched with owner IDs %v, want exactly [%d]", got, attackerOwnerID)
	}
	if got := rig.strava.FetchedIDs; len(got) != 1 || got[0] != victimOwnerID {
		t.Errorf("fetched object IDs %v, want exactly [%d]", got, victimOwnerID)
	}

	// A refused fetch must publish nothing. Publishing an unenriched event here
	// would put an attacker-chosen owner/object pair onto the topic with no
	// Strava confirmation behind it.
	if n := len(rig.primary.Published); n != 0 {
		t.Errorf("published %d events despite a refused cross-owner fetch, want 0", n)
	}
	if n := len(rig.deauth.Published); n != 0 {
		t.Errorf("published %d deauth events for an activity event, want 0", n)
	}

	// Fail-closed so Strava retries rather than silently dropping a real event
	// that failed for a transient reason.
	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 so the delivery is retried", w.Code)
	}
}

// TestSecurity_AcceptedEventWorkFactorIsBounded measures the downstream work one
// accepted webhook buys, which is the quantity D-5 was about: an amplification
// finding is a statement about this ratio. Pinning it turns "we reasoned about
// the cost once" into a regression — a future fan-out, retry loop, or
// per-event extra read shows up here as a number change rather than silently.
func TestSecurity_AcceptedEventWorkFactorIsBounded(t *testing.T) {
	rig := newSecurityRig(t, true)

	w := rig.post(activityBody(attackerOwnerID, 909090))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	// One request buys exactly one of each. These are the numbers the assessment
	// recorded; if one moves, the amplification finding needs re-reading, not
	// this assertion loosening.
	if got := rig.allow.CalledCount(); got != 1 {
		t.Errorf("allowlist reads = %d, want 1 per accepted event", got)
	}
	if got := len(rig.strava.FetchedIDs); got != 1 {
		t.Errorf("Strava calls = %d, want 1 per accepted event", got)
	}
	if got := len(rig.primary.Published); got != 1 {
		t.Errorf("primary publishes = %d, want 1 per accepted event", got)
	}
	if got := len(rig.deauth.Published); got != 0 {
		t.Errorf("deauth publishes = %d, want 0 for an activity event", got)
	}
}

// TestSecurity_StrayOwnerCostsNothingDownstream is the other half of the work
// factor: a non-allowlisted owner must be refused before any paid operation, so
// the allowlist read is the entire cost of a stray event.
func TestSecurity_StrayOwnerCostsNothingDownstream(t *testing.T) {
	rig := newSecurityRig(t, false)

	w := rig.post(activityBody(attackerOwnerID, 909090))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (stray events are acked quietly)", w.Code)
	}

	if got := rig.allow.CalledCount(); got != 1 {
		t.Errorf("allowlist reads = %d, want 1", got)
	}
	if got := len(rig.strava.FetchedIDs); got != 0 {
		t.Errorf("Strava calls = %d, want 0 — a stray owner must not spend quota", got)
	}
	if got := len(rig.primary.Published); got != 0 {
		t.Errorf("primary publishes = %d, want 0", got)
	}
}
