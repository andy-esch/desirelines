package httpadapter

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/dispatcher/types/generated"
	"github.com/andy-esch/desirelines/packages/shared/activityconnection"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
)

func TestWebhookOwnershipRouting(t *testing.T) {
	for _, uid := range []string{"independent-uid", "98765", "67890"} {
		t.Run(uid, func(t *testing.T) {
			primary, deauth := &portstest.MockPublisher{}, &portstest.MockPublisher{}
			strava := &portstest.MockStravaClient{FetchResult: rowPublishTestActivity, VerifyStatus: ports.GrantRevoked}
			tokens, admission := &portstest.MockTokenStore{}, portstest.NewAllowAllMockAllowlist()
			calls := 0
			resolver := &portstest.MockConnectionResolver{ResolveFunc: func(ctx context.Context, subject string) (activityconnection.Record, error) {
				calls++
				r, err := (&portstest.MockConnectionResolver{}).Resolve(ctx, subject)
				if err != nil {
					t.Fatal(err)
				}
				r.UID, r.Provenance, r.BootstrapID = uid, "oauth", ""
				return r, nil
			}}
			rows := &portstest.MockRawPublisher{}
			h := NewHandler(primary, deauth, &portstest.MockSecretProvider{}, strava, tokens, resolver, admission, gcplog.NewNoOpLogger(), &HandlerConfig{RowPublisher: rows})
			owner := ports.CredentialOwner{UID: uid, Subject: testOwnerID}
			// Metadata-only update exercises the secondary fetch after primary publish.
			event := &generated.WebhookEvent{OwnerId: testOwnerID, ObjectId: testObjectID, EventTime: testEventTime, AspectType: generated.AspectType_ASPECT_TYPE_UPDATE, ObjectType: generated.ObjectType_OBJECT_TYPE_ACTIVITY}
			w := httptest.NewRecorder()
			h.handleActivityEvent(context.Background(), w, httptest.NewRequest(http.MethodPost, "/", nil), event, "test")
			if w.Code != http.StatusOK || primary.PublishedCount() != 1 || rows.PublishedCount() != 1 {
				t.Fatalf("status=%d primary=%d rows=%d", w.Code, primary.PublishedCount(), rows.PublishedCount())
			}
			if calls != 1 || len(admission.CalledWith) != 1 || admission.CalledWith[0] != uid || len(strava.FetchedOwners) != 1 || strava.FetchedOwners[0] != owner {
				t.Fatalf("mapping/admission/fetch lost original owner: calls=%d admission=%v fetch=%v", calls, admission.CalledWith, strava.FetchedOwners)
			}
			if primary.Published[0].Event.OwnerId != testOwnerID {
				t.Fatal("provider event owner was replaced by app UID")
			}
			assertResolvedDeauthorization(t, h, event, owner, deauth, strava, tokens, admission)
		})
	}
}

func TestWebhookMappingFailuresRetryWithoutOrphanAcknowledgement(t *testing.T) {
	for _, mappingErr := range []error{activityconnection.ErrNotFound, activityconnection.ErrConflict, context.DeadlineExceeded} {
		for _, athlete := range []bool{false, true} {
			primary, deauth := &portstest.MockPublisher{}, &portstest.MockPublisher{}
			strava, tokens, admission := &portstest.MockStravaClient{}, &portstest.MockTokenStore{}, portstest.NewAllowAllMockAllowlist()
			resolver := &portstest.MockConnectionResolver{ResolveFunc: func(context.Context, string) (activityconnection.Record, error) {
				return activityconnection.Record{}, mappingErr
			}}
			h := NewHandler(primary, deauth, &portstest.MockSecretProvider{}, strava, tokens, resolver, admission, gcplog.NewNoOpLogger(), nil)
			event := &generated.WebhookEvent{OwnerId: testOwnerID, AspectType: generated.AspectType_ASPECT_TYPE_DELETE}
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/", nil)
			if athlete {
				h.handleAthleteEvent(context.Background(), w, r, event, nil)
			} else {
				h.handleActivityEvent(context.Background(), w, r, event, "test")
			}
			if w.Code != http.StatusInternalServerError || parseErrorResponse(w.Body.String()).Code != ErrCodeOwnershipCheckFailed {
				t.Fatalf("mapping failure acknowledged: %d %s", w.Code, w.Body.String())
			}
			if admission.CalledCount() != 0 || primary.PublishedCount() != 0 || deauth.PublishedCount() != 0 || strava.FetchedCount() != 0 || strava.VerifyCalledCount() != 0 || tokens.DeletedCount() != 0 {
				t.Fatal("failed mapping reached admission, provider or publication")
			}
		}
	}
	// A mapping that disappears during credential use must not take the orphan branch.
	primary := &portstest.MockPublisher{}
	strava := &portstest.MockStravaClient{FetchErr: errors.Join(activityconnection.ErrNotFound, context.DeadlineExceeded)}
	h := NewHandler(primary, &portstest.MockPublisher{}, &portstest.MockSecretProvider{}, strava, &portstest.MockTokenStore{}, &portstest.MockConnectionResolver{}, portstest.NewAllowAllMockAllowlist(), gcplog.NewNoOpLogger(), nil)
	w := httptest.NewRecorder()
	h.handleActivityEvent(context.Background(), w, httptest.NewRequest(http.MethodPost, "/", nil), &generated.WebhookEvent{OwnerId: testOwnerID, AspectType: generated.AspectType_ASPECT_TYPE_CREATE}, "test")
	if w.Code != http.StatusInternalServerError || primary.PublishedCount() != 0 {
		t.Fatalf("late mapping failure acknowledged: %d", w.Code)
	}
}

func assertResolvedDeauthorization(t *testing.T, h *Handler, event *generated.WebhookEvent, owner ports.CredentialOwner, deauth *portstest.MockPublisher, strava *portstest.MockStravaClient, tokens *portstest.MockTokenStore, admission *portstest.MockAllowlist) {
	t.Helper()
	uid := owner.UID
	admission.Allowed = false // Cleanup must still work after admission is removed.
	event.ObjectType, event.AspectType = generated.ObjectType_OBJECT_TYPE_ATHLETE, generated.AspectType_ASPECT_TYPE_DELETE
	w := httptest.NewRecorder()
	h.handleAthleteEvent(context.Background(), w, httptest.NewRequest(http.MethodPost, "/", nil), event, nil)
	if w.Code != http.StatusOK || deauth.PublishedCount() != 1 || len(tokens.DeletedOwners) != 1 || tokens.DeletedOwners[0] != owner || strava.VerifiedOwners[0] != owner {
		t.Fatalf("deauth lost owner: status=%d deleted=%v verified=%v", w.Code, tokens.DeletedOwners, strava.VerifiedOwners)
	}
	if len(admission.CalledWith) != 1 || len(admission.InvalidatedWith) != 1 || admission.InvalidatedWith[0] != uid {
		t.Fatalf("deauth admission calls=%v invalidated=%v", admission.CalledWith, admission.InvalidatedWith)
	}
}
