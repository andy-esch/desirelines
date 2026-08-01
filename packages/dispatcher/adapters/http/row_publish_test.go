package httpadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andy-esch/desirelines/packages/dispatcher/adapters/bqrow"
	webhookproto "github.com/andy-esch/desirelines/packages/dispatcher/adapters/proto"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// rowPublishTestActivity is the payload the mock Strava client returns when a
// test's event triggers a fetch.
var rowPublishTestActivity = []byte(`{"id":12345,"name":"Morning Run","sport_type":"Run","workout_type":3}`)

type rowPublishSetup struct {
	// rowPublisher is what the feature flag controls: nil means off.
	rowPublisher ports.RawPublisher
	rowCounter   *sdkmetric.ManualReader
	primary      *portstest.MockPublisher
	strava       *portstest.MockStravaClient
}

// serveRowPublishWebhook runs one webhook through a handler wired for the
// activity-row publish, and returns the recorded response.
func serveRowPublishWebhook(t *testing.T, setup *rowPublishSetup, payload webhookproto.StravaWebhookJSON) *httptest.ResponseRecorder {
	t.Helper()

	cfg := &HandlerConfig{RowPublisher: setup.rowPublisher}
	if setup.rowCounter != nil {
		provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(setup.rowCounter))
		counter, err := provider.Meter("test").Int64Counter("desirelines.io/bigquery/row_publish")
		if err != nil {
			t.Fatalf("create counter: %v", err)
		}
		cfg.RowPublishCounter = counter
	}

	handler := NewHandler(
		setup.primary,
		&portstest.MockPublisher{},
		&portstest.MockSecretProvider{SubscriptionID: testSubscriptionID},
		setup.strava,
		&portstest.MockTokenStore{},
		portstest.NewAllowAllMockAllowlist(),
		gcplog.NewNoOpLogger(),
		cfg,
	)

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.RegisterRoutes().ServeHTTP(w, req)
	return w
}

func activityWebhook(aspectType string) webhookproto.StravaWebhookJSON {
	return webhookproto.StravaWebhookJSON{
		AspectType:     aspectType,
		ObjectType:     "activity",
		ObjectID:       testObjectID,
		OwnerID:        testOwnerID,
		EventTime:      testEventTime,
		SubscriptionID: testSubscriptionID,
	}
}

// TestActivityRowPublish_ChangeTypes covers which events produce a row and
// which are deliberately skipped. The skips matter as much as the publishes: a
// CDC upsert replaces the entire row, so publishing an event that carries only
// part of an activity would blank every column it omits.
func TestActivityRowPublish_ChangeTypes(t *testing.T) {
	tests := []struct {
		name           string
		payload        webhookproto.StravaWebhookJSON
		stravaErr      error
		wantPublished  int
		wantChangeType string
	}{
		{
			name:           "create publishes an upsert",
			payload:        activityWebhook("create"),
			wantPublished:  1,
			wantChangeType: bqrow.ChangeTypeUpsert,
		},
		{
			name: "type-change update publishes an upsert",
			payload: func() webhookproto.StravaWebhookJSON {
				p := activityWebhook("update")
				p.Updates = map[string]any{"type": "Ride"}
				return p
			}(),
			wantPublished:  1,
			wantChangeType: bqrow.ChangeTypeUpsert,
		},
		{
			name:           "delete publishes a delete",
			payload:        activityWebhook("delete"),
			wantPublished:  1,
			wantChangeType: bqrow.ChangeTypeDelete,
		},
		{
			// Title-only edit: no activity is fetched, so a row published
			// here would overwrite the stored activity with almost nothing.
			name: "title-only update publishes nothing",
			payload: func() webhookproto.StravaWebhookJSON {
				p := activityWebhook("update")
				p.Updates = map[string]any{"title": "New name"}
				return p
			}(),
			wantPublished: 0,
		},
		{
			// The activity was deleted between the webhook and the fetch —
			// there is no row to write.
			name:          "create whose activity has vanished publishes nothing",
			payload:       activityWebhook("create"),
			stravaErr:     ports.ErrActivityNotFound,
			wantPublished: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rowPublisher := &portstest.MockRawPublisher{}
			setup := &rowPublishSetup{
				rowPublisher: rowPublisher,
				primary:      &portstest.MockPublisher{},
				strava: &portstest.MockStravaClient{
					FetchResult: rowPublishTestActivity,
					FetchErr:    tt.stravaErr,
				},
			}

			w := serveRowPublishWebhook(t, setup, tt.payload)
			if w.Code != http.StatusCreated && w.Code != http.StatusOK {
				t.Fatalf("status = %d, want a success (body: %s)", w.Code, w.Body.String())
			}

			if got := rowPublisher.PublishedCount(); got != tt.wantPublished {
				t.Fatalf("published %d rows, want %d", got, tt.wantPublished)
			}
			if tt.wantPublished == 0 {
				return
			}

			row := rowPublisher.PublishedBodies()[0]
			if got := row["_CHANGE_TYPE"]; got != tt.wantChangeType {
				t.Errorf("_CHANGE_TYPE = %v, want %q", got, tt.wantChangeType)
			}
			if got, ok := row["_CHANGE_SEQUENCE_NUMBER"].(string); !ok || got == "" {
				t.Errorf("_CHANGE_SEQUENCE_NUMBER = %#v, want a non-empty string", row["_CHANGE_SEQUENCE_NUMBER"])
			}
			if got, ok := row["id"].(float64); !ok || int64(got) != testObjectID {
				t.Errorf("id = %#v, want %d", row["id"], testObjectID)
			}
		})
	}
}

// The flag is off by default, and off means the handler holds no publisher at
// all — there is no code path from a webhook to the rows topic.
func TestActivityRowPublish_DisabledPublishesNothing(t *testing.T) {
	rowPublisher := &portstest.MockRawPublisher{}
	primary := &portstest.MockPublisher{}

	setup := &rowPublishSetup{
		// Deliberately NOT wired into the handler: this is what the flag
		// being off looks like from in here.
		rowPublisher: nil,
		primary:      primary,
		strava:       &portstest.MockStravaClient{FetchResult: rowPublishTestActivity},
	}

	w := serveRowPublishWebhook(t, setup, activityWebhook("create"))

	if w.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d (body: %s)", w.Code, http.StatusCreated, w.Body.String())
	}
	if got := primary.PublishedCount(); got != 1 {
		t.Errorf("primary published %d events, want 1", got)
	}
	if got := rowPublisher.PublishedCount(); got != 0 {
		t.Errorf("published %d rows with the feature off, want 0", got)
	}
}

// The whole point of the second publish being best-effort: a broken rows topic
// must be invisible to Strava and to the primary pipeline.
func TestActivityRowPublish_FailureDoesNotAffectWebhook(t *testing.T) {
	tests := []struct {
		name         string
		rowPublisher ports.RawPublisher
		strava       *portstest.MockStravaClient
	}{
		{
			name:         "publish error",
			rowPublisher: &portstest.MockRawPublisher{PublishErr: errors.New("topic unavailable")},
			strava:       &portstest.MockStravaClient{FetchResult: rowPublishTestActivity},
		},
		{
			// Mapping failure: the activity JSON has no id, so no row can be
			// addressed. The primary publish carries the same payload happily.
			name:         "unmappable activity payload",
			rowPublisher: &portstest.MockRawPublisher{},
			strava:       &portstest.MockStravaClient{FetchResult: []byte(`{"name":"no id here"}`)},
		},
		{
			name:         "malformed activity payload",
			rowPublisher: &portstest.MockRawPublisher{},
			strava:       &portstest.MockStravaClient{FetchResult: []byte(`{"id":`)},
		},
		{
			name:         "publisher panics",
			rowPublisher: panicRawPublisher{},
			strava:       &portstest.MockStravaClient{FetchResult: rowPublishTestActivity},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			primary := &portstest.MockPublisher{}
			setup := &rowPublishSetup{
				rowPublisher: tt.rowPublisher,
				primary:      primary,
				strava:       tt.strava,
			}

			w := serveRowPublishWebhook(t, setup, activityWebhook("create"))

			if w.Code != http.StatusCreated {
				t.Errorf("status = %d, want %d — a row-publish failure must not fail the webhook (body: %s)",
					w.Code, http.StatusCreated, w.Body.String())
			}
			if got := primary.PublishedCount(); got != 1 {
				t.Errorf("primary published %d events, want 1 — the primary path must be untouched", got)
			}
		})
	}
}

// panicRawPublisher is the worst case the recover() in publishActivityRow
// exists for: a publisher that blows up after the webhook has already been
// handled successfully.
type panicRawPublisher struct{}

func (panicRawPublisher) PublishRaw(context.Context, []byte, string) error {
	//nolint:forbidigo // panicking IS the behavior under test; the handler must survive it
	panic("publisher exploded")
}

func (panicRawPublisher) Close(context.Context) error { return nil }

// Every activity event records exactly one row-publish outcome, so the counter
// can be read as "what happened to the rows we owed BigQuery".
func TestActivityRowPublish_RecordsOutcome(t *testing.T) {
	tests := []struct {
		name         string
		payload      webhookproto.StravaWebhookJSON
		rowPublisher ports.RawPublisher
		wantResult   string
		wantDetail   string
	}{
		{
			name:         "published",
			payload:      activityWebhook("create"),
			rowPublisher: &portstest.MockRawPublisher{},
			wantResult:   rowPublishPublished,
			wantDetail:   bqrow.ChangeTypeUpsert,
		},
		{
			name: "skipped",
			payload: func() webhookproto.StravaWebhookJSON {
				p := activityWebhook("update")
				p.Updates = map[string]any{"title": "New name"}
				return p
			}(),
			rowPublisher: &portstest.MockRawPublisher{},
			wantResult:   rowPublishSkipped,
			wantDetail:   rowSkipPartialUpdate,
		},
		{
			name:         "error",
			payload:      activityWebhook("create"),
			rowPublisher: &portstest.MockRawPublisher{PublishErr: errors.New("topic unavailable")},
			wantResult:   rowPublishError,
			wantDetail:   "publish",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reader := sdkmetric.NewManualReader()
			setup := &rowPublishSetup{
				rowPublisher: tt.rowPublisher,
				rowCounter:   reader,
				primary:      &portstest.MockPublisher{},
				strava:       &portstest.MockStravaClient{FetchResult: rowPublishTestActivity},
			}

			serveRowPublishWebhook(t, setup, tt.payload)

			var rm metricdata.ResourceMetrics
			if err := reader.Collect(context.Background(), &rm); err != nil {
				t.Fatalf("collect metrics: %v", err)
			}

			labels := rowPublishLabels(rm)
			if len(labels) != 1 {
				t.Fatalf("expected exactly 1 row_publish increment, got %d (%v)", len(labels), labels)
			}
			if labels[0].result != tt.wantResult || labels[0].detail != tt.wantDetail {
				t.Errorf("labels = %+v, want result=%q detail=%q", labels[0], tt.wantResult, tt.wantDetail)
			}
		})
	}
}

type rowPublishLabel struct {
	result string
	detail string
}

// rowPublishLabels collects the result/detail label pair from each
// row_publish counter data point in the resource metrics.
func rowPublishLabels(rm metricdata.ResourceMetrics) []rowPublishLabel {
	var out []rowPublishLabel
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "desirelines.io/bigquery/row_publish" {
				continue
			}
			sum, ok := m.Data.(metricdata.Sum[int64])
			if !ok {
				continue
			}
			for _, dp := range sum.DataPoints {
				var label rowPublishLabel
				if v, exists := dp.Attributes.Value("result"); exists {
					label.result = v.AsString()
				}
				if v, exists := dp.Attributes.Value("detail"); exists {
					label.detail = v.AsString()
				}
				out = append(out, label)
			}
		}
	}
	return out
}
