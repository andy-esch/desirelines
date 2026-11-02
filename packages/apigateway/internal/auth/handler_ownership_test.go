package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
)

func ownershipCallback(t *testing.T, h *Handler) *httptest.ResponseRecorder {
	t.Helper()
	state, err := generateState(h.stateSecret)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/auth/callback?code=auth-code&state="+url.QueryEscape(state), nil)
	addStateCookie(request, h, state)
	w := httptest.NewRecorder()
	h.HandleCallback(w, request)
	return w
}

func ownershipStrava() *mockStravaOAuth {
	return &mockStravaOAuth{resp: &StravaTokenResponse{AccessToken: "access", RefreshToken: "refresh", ExpiresAt: 2000000000, Scope: "read,activity:read_all", Athlete: StravaAthlete{ID: 12345, FirstName: "Owner", LastName: "Name"}}}
}

func TestCallbackUsesResolvedUIDAcrossAllAccountOperations(t *testing.T) {
	for _, uid := range []string{"opaque-app-uid", "98765", "12345"} {
		t.Run(uid, func(t *testing.T) {
			owner := legacyOwner("12345")
			owner.UID = uid
			if uid != owner.Subject {
				owner.Provenance = "oauth"
				owner.BootstrapID = ""
			}
			connections := &mockConnectionResolver{owner: &owner}
			tokens, allow, firebase := &mockTokenStore{}, &mockAllowlist{allowed: true}, &mockFirebase{token: "custom-token"}
			h := newTestHandler(t, ownershipStrava(), tokens, allow, firebase)
			h.connections = connections
			w := ownershipCallback(t, h)
			if !strings.Contains(w.Header().Get("Location"), "/auth/complete#token=custom-token") {
				t.Fatalf("callback redirected to %q", w.Header().Get("Location"))
			}
			if connections.calledWith != "12345" || tokens.owner.Subject != "12345" {
				t.Fatal("provider subject was replaced with an app UID")
			}
			if allow.calledWith != uid || tokens.calledWith != uid || firebase.calledWith != uid || firebase.updateUserUID != uid {
				t.Fatalf("account operations used inconsistent UIDs: admission=%q storage=%q token=%q profile=%q", allow.calledWith, tokens.calledWith, firebase.calledWith, firebase.updateUserUID)
			}
		})
	}
}

func TestCallbackOwnershipFailuresDoNotMintFirebaseTokens(t *testing.T) {
	owner := legacyOwner("12345")
	wrongSubject := owner
	wrongSubject.Subject = "67890"
	wrongSubject.Provenance = "oauth"
	inactive := owner
	inactive.Status = "disconnected"
	cases := []struct {
		name                 string
		resolveErr, writeErr error
		record               *activityconnection.Record
		want                 string
	}{
		{"missing mapping", activityconnection.ErrNotFound, nil, nil, "not_invited"},
		{"conflicting mapping", activityconnection.ErrConflict, nil, nil, "server_error"},
		{"resolver canceled", context.Canceled, nil, nil, "server_error"},
		{"wrong subject", nil, nil, &wrongSubject, "server_error"},
		{"invalid record", nil, nil, &activityconnection.Record{}, "server_error"},
		{"inactive record", nil, nil, &inactive, "server_error"},
		{"deleted before write", nil, activityconnection.ErrNotFound, nil, "not_invited"},
		{"revoked before write", nil, activityconnection.ErrAdmissionDenied, nil, "not_invited"},
		{"reassigned before write", nil, activityconnection.ErrConflict, nil, "server_error"},
		{"write backend failure", nil, errors.New("unavailable"), nil, "server_error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tokens, allow, firebase := &mockTokenStore{writeErr: tc.writeErr}, &mockAllowlist{allowed: true}, &mockFirebase{token: "test-token"}
			h := newTestHandler(t, ownershipStrava(), tokens, allow, firebase)
			h.connections = &mockConnectionResolver{owner: tc.record, err: tc.resolveErr}
			w := ownershipCallback(t, h)
			if !strings.Contains(w.Header().Get("Location"), "/auth/error?error="+tc.want) {
				t.Fatalf("callback location = %q", w.Header().Get("Location"))
			}
			if firebase.calledWith != "" || firebase.updateUserCalled {
				t.Fatal("failed ownership check reached Firebase Auth")
			}
			if tc.writeErr == nil && (tokens.called || allow.calledWith != "") {
				t.Fatal("failed ownership resolution reached account storage/admission")
			}
		})
	}
}

func TestNewHandlerRequiresConnectionResolver(t *testing.T) {
	_, err := NewHandler(&HandlerConfig{StateSecret: []byte("test-secret-key-32-bytes-long!!!")})
	if err == nil || !strings.Contains(err.Error(), "resolver is required") {
		t.Fatalf("missing resolver accepted: %v", err)
	}
}
