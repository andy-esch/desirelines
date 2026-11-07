package strava

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/stravatoken"
)

func TestGrantVerificationUsesProviderSubjectWithOpaqueUID(t *testing.T) {
	owner := ports.CredentialOwner{UID: "independent-app-user", Subject: testOwnerID}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v3/athlete" || r.Header.Get("Authorization") != "Bearer access" {
			t.Errorf("unexpected grant verification %s", r.URL.Path)
		}
		if err := json.NewEncoder(w).Encode(athleteResponse{ID: owner.Subject}); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	store := &portstest.MockTokenStore{Tokens: map[ports.CredentialOwner]*stravatoken.Data{owner: {AccessToken: "access", RefreshToken: "refresh", ExpiresAt: futureExpiry()}}}
	client := newTestClient(server, store)
	grant, err := client.VerifyGrant(context.Background(), owner)
	if err != nil || grant != ports.GrantActive {
		t.Fatalf("grant=%v err=%v", grant, err)
	}
}

func TestRefreshSingleflightSeparatesOwnersSharingSubject(t *testing.T) {
	owners := []ports.CredentialOwner{{UID: "app-a", Subject: testOwnerID}, {UID: "app-b", Subject: testOwnerID}}
	store := &portstest.MockTokenStore{Tokens: map[ports.CredentialOwner]*stravatoken.Data{}}
	for _, owner := range owners {
		store.Tokens[owner] = &stravatoken.Data{AccessToken: "expired", RefreshToken: owner.UID, ExpiresAt: pastExpiry()}
	}
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != testTokenPath {
			if _, err := w.Write([]byte(`{"id":12345}`)); err != nil {
				t.Error(err)
			}
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Error(err)
			return
		}
		entered <- struct{}{}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		if err := json.NewEncoder(w).Encode(tokenResponse{AccessToken: "next-" + r.Form.Get(paramRefreshToken), RefreshToken: "new-refresh", ExpiresAt: futureExpiry()}); err != nil { //nolint:gosec // Synthetic token endpoint response; never production credentials.
			t.Error(err)
		}
	}))
	defer server.Close()
	client := newTestClient(server, store)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, owner := range owners {
		wg.Go(func() { _, err := client.FetchActivity(ctx, owner, testActivityID); errs <- err })
	}
	awaitRefreshCalls(t, entered, len(owners))
	close(release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, owner := range owners {
		got := store.WrittenTokens[owner]
		if got == nil || got.AccessToken != "next-"+owner.UID {
			t.Fatalf("refresh adopted another owner: %+v = %v", owner, got)
		}
	}
}

type ownershipWriteStore struct {
	*portstest.MockTokenStore
	owners  []ports.CredentialOwner
	failure error
}

func (s *ownershipWriteStore) WriteTokensIfUnmodified(_ context.Context, owner ports.CredentialOwner, _ *stravatoken.Data, _ time.Time) (time.Time, error) {
	s.owners = append(s.owners, owner)
	return time.Time{}, s.failure
}

func TestRefreshStopsOnOwnershipChange(t *testing.T) {
	for _, registryErr := range []error{activityconnection.ErrConflict, activityconnection.ErrNotFound} {
		t.Run(registryErr.Error(), func(t *testing.T) {
			owner := ports.CredentialOwner{UID: "captured-app-owner", Subject: testOwnerID}
			store := &ownershipWriteStore{MockTokenStore: &portstest.MockTokenStore{Tokens: map[ports.CredentialOwner]*stravatoken.Data{owner: {AccessToken: "expired", RefreshToken: "refresh", ExpiresAt: pastExpiry()}}}, failure: registryErr}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != testTokenPath {
					t.Errorf("ownership failure reached activity API: %s", r.URL.Path)
				}
				if err := json.NewEncoder(w).Encode(tokenResponse{AccessToken: "new", RefreshToken: "new-refresh", ExpiresAt: futureExpiry()}); err != nil { //nolint:gosec // Synthetic token endpoint response; never production credentials.
					t.Error(err)
				}
			}))
			defer server.Close()
			client := newTestClient(server, store)
			_, err := client.FetchActivity(context.Background(), owner, testActivityID)
			if !errors.Is(err, registryErr) || errors.Is(err, ports.ErrTokenNotFound) || !errors.Is(err, errTokenStoreUnavailable) {
				t.Fatalf("lost registry error classification: %v", err)
			}
			if len(store.owners) != 1 || store.owners[0] != owner {
				t.Fatalf("ownership write retried/retargeted: %v", store.owners)
			}
		})
	}
}

func awaitRefreshCalls(t *testing.T, entered <-chan struct{}, count int) {
	t.Helper()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	for range count {
		select {
		case <-entered:
		case <-timer.C:
			t.Error("different owners shared one provider refresh")
			return
		}
	}
}
