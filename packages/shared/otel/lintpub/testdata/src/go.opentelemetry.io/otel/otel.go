// Stub of go.opentelemetry.io/otel for analysistest fixtures.
// Provides GetTextMapPropagator so the fixtures can build the canonical
// `otel.GetTextMapPropagator().Inject(...)` chain the analyzer matches.
package otel

import "go.opentelemetry.io/otel/propagation"

type noopPropagator struct{}

func (noopPropagator) Inject(ctx any, carrier propagation.TextMapCarrier)      {}
func (noopPropagator) Extract(ctx any, carrier propagation.TextMapCarrier) any { return nil }

func GetTextMapPropagator() propagation.TextMapPropagator {
	return noopPropagator{}
}
