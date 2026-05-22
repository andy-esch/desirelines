// Stub package providing a GetTextMapPropagator() that returns a
// LOCAL propagator type — i.e. one NOT under go.opentelemetry.io/.
//
// Exists so a fixture can exercise isPropagatorInject's Path 2: an
// Inject call whose method package fails the otel-prefix check (Path 1
// false) but whose receiver is a `*.GetTextMapPropagator()` call
// (Path 2 true). Path 2 is the documented hedge against OTel SDK
// interface re-exports occasionally confusing the type-checker.
package localotel

type Propagator struct{}

func (Propagator) Inject(ctx, carrier any) {}

func GetTextMapPropagator() Propagator { return Propagator{} }
