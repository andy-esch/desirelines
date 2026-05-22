// Stub of go.opentelemetry.io/otel/propagation for analysistest fixtures.
// Just enough surface for the fixtures to construct an Inject call the
// analyzer recognizes by import-path heuristic.
package propagation

type TextMapCarrier interface {
	Get(key string) string
	Set(key, value string)
	Keys() []string
}

type TextMapPropagator interface {
	Inject(ctx any, carrier TextMapCarrier)
	Extract(ctx any, carrier TextMapCarrier) any
}

type MapCarrier map[string]string

func (m MapCarrier) Get(key string) string { return m[key] }
func (m MapCarrier) Set(key, value string) { m[key] = value }
func (m MapCarrier) Keys() []string        { return nil }
