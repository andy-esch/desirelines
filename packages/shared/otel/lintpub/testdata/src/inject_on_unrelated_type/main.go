// Fixture: a Publish call paired with an `.Inject(...)` call on a
// LOCAL type (not OTel). isPropagatorInject must reject the local
// Inject so the analyzer still flags the Publish.
//
// Covers Path 1 of isPropagatorInject returning false (obj.Pkg() is
// not under go.opentelemetry.io/) and Path 2 also returning false (the
// receiver is not a `*.GetTextMapPropagator()` call).
package inject_on_unrelated_type

import (
	pubsub "cloud.google.com/go/pubsub/v2"
)

type FakePropagator struct{}

func (f *FakePropagator) Inject(ctx, carrier any) {}

func PublishWithFakeInject() {
	p := &pubsub.Publisher{}
	fi := &FakePropagator{}
	fi.Inject(nil, nil) // not the OTel propagator; analyzer must not credit this
	p.Publish(nil, nil) // want `pubsub.Publisher.Publish called without propagator.Inject`
}
