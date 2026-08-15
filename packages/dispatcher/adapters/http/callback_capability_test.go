package httpadapter

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"github.com/andy-esch/desirelines/packages/shared/ratelimit"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

const testWebhookCapability = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func newCallbackCapabilityHandler(t *testing.T, mode config.WebhookRouteMode, capability string, mutate func(*HandlerConfig)) *Handler {
	t.Helper()
	cfg := &HandlerConfig{
		WebhookRouteMode:          mode,
		WebhookCallbackCapability: capability,
	}
	if mutate != nil {
		mutate(cfg)
	}
	return NewHandler(
		&portstest.MockPublisher{},
		&portstest.MockPublisher{},
		&portstest.MockSecretProvider{VerifyToken: "verify-token", SubscriptionID: testSubscriptionID},
		&portstest.MockStravaClient{},
		&portstest.MockTokenStore{},
		portstest.NewAllowAllMockAllowlist(),
		gcplog.NewNoOpLogger(),
		cfg,
	)
}

func verificationRequest(path string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	q := req.URL.Query()
	q.Set("hub.mode", "subscribe")
	q.Set("hub.challenge", "challenge")
	q.Set("hub.verify_token", "verify-token")
	req.URL.RawQuery = q.Encode()
	return req
}

func TestWebhookCallbackCapability_RouteModes(t *testing.T) {
	tests := []struct {
		name       string
		mode       config.WebhookRouteMode
		path       string
		wantStatus int
	}{
		{"legacy accepts plain route", config.WebhookRouteModeLegacy, "/webhook", http.StatusOK},
		{"legacy does not expose capability route", config.WebhookRouteModeLegacy, "/webhook/" + testWebhookCapability, http.StatusNotFound},
		{"dual accepts plain route", config.WebhookRouteModeDual, "/webhook", http.StatusOK},
		{"dual accepts capability route", config.WebhookRouteModeDual, "/webhook/" + testWebhookCapability, http.StatusOK},
		{"dual rejects wrong capability", config.WebhookRouteModeDual, "/webhook/" + strings.Repeat("1", 64), http.StatusNotFound},
		{"capability rejects plain route", config.WebhookRouteModeCapability, "/webhook", http.StatusNotFound},
		{"capability accepts capability route", config.WebhookRouteModeCapability, "/webhook/" + testWebhookCapability, http.StatusOK},
		{"unknown mode fails closed", config.WebhookRouteMode("unknown"), "/webhook/" + testWebhookCapability, http.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newCallbackCapabilityHandler(t, tt.mode, testWebhookCapability, nil)
			w := httptest.NewRecorder()
			h.RegisterRoutes().ServeHTTP(w, verificationRequest(tt.path))
			if w.Code != tt.wantStatus {
				t.Errorf("GET %s = %d, want %d; body=%q", tt.path, w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}

func TestWebhookCallbackCapability_ValidPostReachesExistingValidation(t *testing.T) {
	h := newCallbackCapabilityHandler(t, config.WebhookRouteModeCapability, testWebhookCapability, nil)

	for _, tc := range []struct {
		name           string
		subscriptionID int
		wantStatus     int
	}{
		{"correct subscription reaches handler", testSubscriptionID, http.StatusOK},
		{"wrong subscription is still rejected", testSubscriptionID + 1, http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := fmt.Sprintf(
				`{"aspect_type":"create","object_type":"athlete","object_id":1,"owner_id":9,"event_time":1,"subscription_id":%d}`,
				tc.subscriptionID,
			)
			req := httptest.NewRequest(http.MethodPost, "/webhook/"+testWebhookCapability, strings.NewReader(body))
			req.Header.Set("Content-Type", contentTypeJSON)
			w := httptest.NewRecorder()
			h.RegisterRoutes().ServeHTTP(w, req)
			if w.Code != tc.wantStatus {
				t.Errorf("POST capability route = %d, want %d; body=%q", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestWebhookCallbackCapability_InvalidCandidatesAreUniformAndUnread(t *testing.T) {
	h := newCallbackCapabilityHandler(t, config.WebhookRouteModeCapability, testWebhookCapability, nil)
	instrumented := false
	router := h.RegisterRoutesInstrumented(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			instrumented = true
			next.ServeHTTP(w, r)
		})
	})
	wantBody := "404 page not found\n"

	paths := []string{
		"/webhook",
		"/webhook/",
		"/webhook/short",
		"/webhook/" + strings.Repeat("A", 64),
		"/webhook/" + strings.Repeat("g", 64),
		"/webhook/" + strings.Repeat("1", 65),
		"/webhook/%2f" + strings.Repeat("1", 62),
		"/webhook/%61" + testWebhookCapability[1:],
		"/webhook/" + strings.Repeat("1", 64) + "/extra",
		"/webhook%2F" + testWebhookCapability,
		"/webhook%252F" + testWebhookCapability,
		"/webhooks/" + testWebhookCapability,
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			instrumented = false
			body := &trackingBody{}
			req := httptest.NewRequest(http.MethodPost, path, nil)
			req.Body = body
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusNotFound || w.Body.String() != wantBody {
				t.Errorf("response = (%d, %q), want uniform (404, %q)", w.Code, w.Body.String(), wantBody)
			}
			if body.read {
				t.Error("invalid capability caused the request body to be read")
			}
			if instrumented {
				t.Error("invalid capability reached HTTP instrumentation")
			}
		})
	}
}

func TestWebhookCallbackCapability_RejectionMatchesOrdinaryNotFoundResponse(t *testing.T) {
	capabilityHandler := newCallbackCapabilityHandler(t, config.WebhookRouteModeCapability, testWebhookCapability, nil)
	legacyHandler := newCallbackCapabilityHandler(t, config.WebhookRouteModeLegacy, testWebhookCapability, nil)

	responses := make([]*httptest.ResponseRecorder, 0, 3)
	for _, tc := range []struct {
		router http.Handler
		path   string
	}{
		{capabilityHandler.RegisterRoutes(), "/webhook/" + strings.Repeat("1", 64)},
		{capabilityHandler.RegisterRoutes(), "/not-found"},
		{legacyHandler.RegisterRoutes(), "/webhook/" + testWebhookCapability},
	} {
		w := httptest.NewRecorder()
		tc.router.ServeHTTP(w, verificationRequest(tc.path))
		responses = append(responses, w)
	}

	want := responses[0]
	for i, got := range responses[1:] {
		if got.Code != want.Code || got.Body.String() != want.Body.String() || !reflect.DeepEqual(got.Header(), want.Header()) {
			t.Errorf("response %d = (%d, %q, %v), want (%d, %q, %v)",
				i+1, got.Code, got.Body.String(), got.Header(), want.Code, want.Body.String(), want.Header())
		}
	}
}

func TestWebhookCallbackCapability_NonCanonicalCredentialPathsNeverExposeCredentialToTelemetry(t *testing.T) {
	encodedCapability := percentEncodeASCII(testWebhookCapability)
	targets := []string{
		"//webhook/" + testWebhookCapability,
		"/./webhook/" + testWebhookCapability,
		"/WEBHOOK/" + testWebhookCapability,
		"/%77ebhook/" + testWebhookCapability,
		"/webhook/" + testWebhookCapability + "%00",
		"/webhook/" + testWebhookCapability + ";x",
		"/webhook/" + testWebhookCapability + ".json",
		"/unrelated/" + testWebhookCapability,
		"/unrelated/" + encodedCapability,
		"/unrelated/" + strings.ReplaceAll(encodedCapability, "%", "%25"),
	}

	for _, mode := range []config.WebhookRouteMode{
		config.WebhookRouteModeLegacy,
		config.WebhookRouteModeDual,
		config.WebhookRouteModeCapability,
	} {
		t.Run(string(mode), func(t *testing.T) {
			logger, capture := gcplog.NewCaptureLogger()
			h := NewHandler(
				&portstest.MockPublisher{},
				&portstest.MockPublisher{},
				&portstest.MockSecretProvider{VerifyToken: "verify-token", SubscriptionID: testSubscriptionID},
				&portstest.MockStravaClient{},
				&portstest.MockTokenStore{},
				portstest.NewAllowAllMockAllowlist(),
				logger,
				&HandlerConfig{
					WebhookRouteMode:          mode,
					WebhookCallbackCapability: testWebhookCapability,
				},
			)

			instrumentPath := ""
			router := h.RegisterRoutesInstrumented(func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					instrumentPath = r.URL.Path
					next.ServeHTTP(w, r)
				})
			})

			for _, target := range targets {
				t.Run(target, func(t *testing.T) {
					instrumentPath = ""
					w := httptest.NewRecorder()
					router.ServeHTTP(w, verificationRequest(target))
					if w.Code != http.StatusNotFound || w.Body.String() != "404 page not found\n" {
						t.Errorf("response = (%d, %q), want uniform 404", w.Code, w.Body.String())
					}
					if strings.Contains(instrumentPath, testWebhookCapability) {
						t.Errorf("instrumentation retained callback capability in path %q", instrumentPath)
					}
					if instrumentPath != "" && instrumentPath != redactedWebhookPath {
						t.Errorf("instrumentation path = %q, want empty or redacted", instrumentPath)
					}
					if got := fmt.Sprint(capture.Logs()); strings.Contains(got, testWebhookCapability) {
						t.Errorf("application logs retained callback capability: %s", got)
					}
				})
			}
		})
	}
}

func percentEncodeASCII(value string) string {
	var encoded strings.Builder
	for i := 0; i < len(value); i++ {
		_, _ = fmt.Fprintf(&encoded, "%%%02x", value[i])
	}
	return encoded.String()
}

type trackingBody struct {
	read bool
}

func (b *trackingBody) Read([]byte) (int, error) {
	b.read = true
	return 0, errors.New("body must not be read")
}

func (b *trackingBody) Close() error { return nil }

func TestWebhookCallbackCapability_RejectionPrecedesRateLimiter(t *testing.T) {
	limiter := ratelimit.New(context.Background(), &ratelimit.Config{
		Rate:            0,
		Burst:           1,
		MaxClients:      1,
		CleanupInterval: time.Hour,
	}, gcplog.NewNoOpLogger())
	h := newCallbackCapabilityHandler(t, config.WebhookRouteModeCapability, testWebhookCapability, func(cfg *HandlerConfig) {
		cfg.RateLimiter = limiter
	})
	router := h.RegisterRoutes()

	for range 3 {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, verificationRequest("/webhook/"+strings.Repeat("1", 64)))
		if w.Code != http.StatusNotFound {
			t.Fatalf("wrong capability = %d, want 404", w.Code)
		}
	}

	w := httptest.NewRecorder()
	router.ServeHTTP(w, verificationRequest("/webhook/"+testWebhookCapability))
	if w.Code != http.StatusOK {
		t.Errorf("valid request after rejected guesses = %d, want 200 (rate-limit token must remain available)", w.Code)
	}
}

func TestWebhookCallbackCapability_RedactsBeforeInstrumentationAndLogs(t *testing.T) {
	logger, capture := gcplog.NewCaptureLogger()
	h := NewHandler(
		&portstest.MockPublisher{},
		&portstest.MockPublisher{},
		&portstest.MockSecretProvider{VerifyToken: "verify-token", SubscriptionID: testSubscriptionID},
		&portstest.MockStravaClient{},
		&portstest.MockTokenStore{},
		portstest.NewAllowAllMockAllowlist(),
		logger,
		&HandlerConfig{
			WebhookRouteMode:          config.WebhookRouteModeCapability,
			WebhookCallbackCapability: testWebhookCapability,
		},
	)

	var instrumentPath, instrumentRequestURI string
	router := h.RegisterRoutesInstrumented(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			instrumentPath = r.URL.Path
			instrumentRequestURI = r.RequestURI
			next.ServeHTTP(w, r)
		})
	})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, verificationRequest("/webhook/"+testWebhookCapability))
	if w.Code != http.StatusOK {
		t.Fatalf("verification = %d, want 200", w.Code)
	}
	if instrumentPath != redactedWebhookPath || instrumentRequestURI != redactedWebhookPath {
		t.Errorf("instrumentation saw path=%q requestURI=%q, want %q", instrumentPath, instrumentRequestURI, redactedWebhookPath)
	}
	if got := fmt.Sprint(capture.Logs()); strings.Contains(got, testWebhookCapability) {
		t.Errorf("application logs retained callback capability: %s", got)
	}
}

func TestWebhookCallbackCapability_OTelNeverSeesCredentialPath(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	t.Cleanup(func() {
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Errorf("shutdown trace provider: %v", err)
		}
	})

	h := newCallbackCapabilityHandler(t, config.WebhookRouteModeCapability, testWebhookCapability, nil)
	router := h.RegisterRoutesInstrumented(func(next http.Handler) http.Handler {
		return otelhttp.NewHandler(next, "dispatcher",
			otelhttp.WithTracerProvider(provider),
			otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
				return r.Method + " " + r.URL.Path
			}),
		)
	})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, verificationRequest("/webhook/"+testWebhookCapability))
	if w.Code != http.StatusOK {
		t.Fatalf("verification = %d, want 200", w.Code)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	span := spans[0]
	if strings.Contains(span.Name(), testWebhookCapability) || span.Name() != "GET "+redactedWebhookPath {
		t.Errorf("span name = %q, want redacted", span.Name())
	}
	for _, attr := range span.Attributes() {
		if strings.Contains(attr.Value.String(), testWebhookCapability) {
			t.Errorf("span attribute %q retained callback capability", attr.Key)
		}
		if attr.Key == "url.path" && attr.Value.AsString() != redactedWebhookPath {
			t.Errorf("url.path = %q, want %q", attr.Value.AsString(), redactedWebhookPath)
		}
	}
}

func TestWebhookCallbackCapability_RecordsOnlyBoundedOutcomes(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	counter, err := provider.Meter("test").Int64Counter("desirelines.io/webhook/callback_capability")
	if err != nil {
		t.Fatalf("create counter: %v", err)
	}
	h := newCallbackCapabilityHandler(t, config.WebhookRouteModeDual, testWebhookCapability, func(cfg *HandlerConfig) {
		cfg.CallbackCapabilityCounter = counter
	})
	router := h.RegisterRoutes()

	for _, path := range []string{
		"/webhook",
		"/webhook/" + testWebhookCapability,
		"/webhook/" + strings.Repeat("1", 64),
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, verificationRequest(path))
	}

	var rm metricdata.ResourceMetrics
	if collectErr := reader.Collect(context.Background(), &rm); collectErr != nil {
		t.Fatalf("collect metrics: %v", collectErr)
	}
	got := callbackCapabilityOutcomes(rm)
	want := map[string]int64{
		callbackCapabilityAccepted: 1,
		callbackCapabilityRejected: 1,
		callbackCapabilityLegacy:   1,
	}
	if len(got) != len(want) {
		t.Fatalf("outcomes = %v, want %v", got, want)
	}
	for result, wantCount := range want {
		if got[result] != wantCount {
			t.Errorf("outcome %q = %d, want %d (all: %v)", result, got[result], wantCount, got)
		}
	}
}

func TestWebhookCallbackCapability_HTTPMetricUsesRouteTemplate(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	histogram, err := provider.Meter("test").Float64Histogram("test/http_duration")
	if err != nil {
		t.Fatalf("create histogram: %v", err)
	}
	h := newCallbackCapabilityHandler(t, config.WebhookRouteModeCapability, testWebhookCapability, func(cfg *HandlerConfig) {
		cfg.HTTPHistogram = histogram
	})
	w := httptest.NewRecorder()
	h.RegisterRoutes().ServeHTTP(w, verificationRequest("/webhook/"+testWebhookCapability))
	if w.Code != http.StatusOK {
		t.Fatalf("verification = %d, want 200", w.Code)
	}

	var rm metricdata.ResourceMetrics
	if collectErr := reader.Collect(context.Background(), &rm); collectErr != nil {
		t.Fatalf("collect metrics: %v", collectErr)
	}
	if strings.Contains(fmt.Sprint(rm), testWebhookCapability) {
		t.Fatal("HTTP metric retained callback capability")
	}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "test/http_duration" {
				continue
			}
			points, ok := m.Data.(metricdata.Histogram[float64])
			if !ok || len(points.DataPoints) != 1 {
				t.Fatalf("histogram data = %#v, want one point", m.Data)
			}
			route, exists := points.DataPoints[0].Attributes.Value("http.route")
			if !exists || route.AsString() != "/webhook/{callback_capability}" {
				t.Errorf("http.route = %q (exists=%v), want route template", route.AsString(), exists)
			}
			return
		}
	}
	t.Fatal("HTTP duration metric not collected")
}

func callbackCapabilityOutcomes(rm metricdata.ResourceMetrics) map[string]int64 {
	out := make(map[string]int64)
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "desirelines.io/webhook/callback_capability" {
				continue
			}
			sum, ok := m.Data.(metricdata.Sum[int64])
			if !ok {
				continue
			}
			for _, point := range sum.DataPoints {
				result, exists := point.Attributes.Value("result")
				if exists {
					out[result.AsString()] += point.Value
				}
			}
		}
	}
	return out
}

func TestWebhookCallbackCapability_MissingConfiguredSecretFailsClosed(t *testing.T) {
	for _, capability := range []string{"", "short", strings.Repeat("A", 64)} {
		t.Run(fmt.Sprintf("len_%d", len(capability)), func(t *testing.T) {
			h := newCallbackCapabilityHandler(t, config.WebhookRouteModeCapability, capability, nil)
			w := httptest.NewRecorder()
			h.RegisterRoutes().ServeHTTP(w, verificationRequest("/webhook/"+testWebhookCapability))
			if w.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404", w.Code)
			}
		})
	}
}
