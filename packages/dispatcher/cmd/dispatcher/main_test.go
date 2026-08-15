package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	httpadapter "github.com/andy-esch/desirelines/packages/dispatcher/adapters/http"
	"github.com/andy-esch/desirelines/packages/dispatcher/config"
	"github.com/andy-esch/desirelines/packages/dispatcher/ports/portstest"
	"github.com/andy-esch/desirelines/packages/shared/gcplog"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestLoadWebhookCallbackCapability(t *testing.T) {
	const valid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

	t.Run("legacy does not require secret", func(t *testing.T) {
		unsetTestEnv(t, "STRAVA_WEBHOOK_CALLBACK_CAPABILITY")
		got, err := loadWebhookCallbackCapability(&config.Config{WebhookRouteMode: config.WebhookRouteModeLegacy})
		if err != nil || got != "" {
			t.Fatalf("load legacy capability = (%q, %v), want empty nil", got, err)
		}
	})

	for _, mode := range []config.WebhookRouteMode{
		config.WebhookRouteModeDual,
		config.WebhookRouteModeCapability,
	} {
		t.Run(string(mode)+" loads valid fallback", func(t *testing.T) {
			t.Setenv("STRAVA_WEBHOOK_CALLBACK_CAPABILITY", valid)
			got, err := loadWebhookCallbackCapability(&config.Config{WebhookRouteMode: mode})
			if err != nil {
				t.Fatalf("load capability: %v", err)
			}
			if got != valid {
				t.Fatalf("capability did not round-trip")
			}
		})
	}

	t.Run("required secret missing", func(t *testing.T) {
		unsetTestEnv(t, "STRAVA_WEBHOOK_CALLBACK_CAPABILITY")
		_, err := loadWebhookCallbackCapability(&config.Config{WebhookRouteMode: config.WebhookRouteModeCapability})
		if err == nil || !strings.Contains(err.Error(), "webhook callback capability") {
			t.Fatalf("error = %v, want callback-capability error", err)
		}
	})

	t.Run("malformed secret rejected", func(t *testing.T) {
		t.Setenv("STRAVA_WEBHOOK_CALLBACK_CAPABILITY", strings.Repeat("A", 64))
		_, err := loadWebhookCallbackCapability(&config.Config{WebhookRouteMode: config.WebhookRouteModeDual})
		if err == nil || !strings.Contains(err.Error(), "lowercase hexadecimal") {
			t.Fatalf("error = %v, want canonical-format error", err)
		}
	})
}

func TestBuildDispatcherRouter_RedactsCapabilityBeforeProductionOTel(t *testing.T) {
	const capability = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	t.Cleanup(func() {
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Errorf("shutdown trace provider: %v", err)
		}
	})

	handler := httpadapter.NewHandler(
		&portstest.MockPublisher{},
		&portstest.MockPublisher{},
		&portstest.MockSecretProvider{VerifyToken: "verify-token", SubscriptionID: 1},
		&portstest.MockStravaClient{},
		&portstest.MockTokenStore{},
		portstest.NewAllowAllMockAllowlist(),
		gcplog.NewNoOpLogger(),
		&httpadapter.HandlerConfig{
			WebhookRouteMode:          config.WebhookRouteModeCapability,
			WebhookCallbackCapability: capability,
		},
	)
	router := buildDispatcherRouter(handler, otelhttp.WithTracerProvider(provider))
	req := httptest.NewRequest(http.MethodGet,
		fmt.Sprintf("/webhook/%s?hub.mode=subscribe&hub.challenge=challenge&hub.verify_token=verify-token", capability), nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("verification = %d, want 200; body=%q", w.Code, w.Body.String())
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	span := spans[0]
	if strings.Contains(span.Name(), capability) || span.Name() != "GET /webhook/[redacted]" {
		t.Errorf("span name = %q, want redacted", span.Name())
	}
	for _, attr := range span.Attributes() {
		if strings.Contains(attr.Value.String(), capability) {
			t.Errorf("span attribute %q retained callback capability", attr.Key)
		}
		if attr.Key == "url.path" && attr.Value.AsString() != "/webhook/[redacted]" {
			t.Errorf("url.path = %q, want redacted", attr.Value.AsString())
		}
	}
}

func unsetTestEnv(t *testing.T, key string) {
	t.Helper()
	previous, existed := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("unset %s: %v", key, err)
	}
	t.Cleanup(func() {
		if existed {
			if err := os.Setenv(key, previous); err != nil {
				t.Errorf("restore %s: %v", key, err)
			}
		} else if err := os.Unsetenv(key); err != nil {
			t.Errorf("clear %s: %v", key, err)
		}
	})
}
