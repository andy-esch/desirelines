// Fixture: a function that injects trace context before publishing.
// The analyzer must NOT flag this.
package publish_with_inject

import (
	pubsub "cloud.google.com/go/pubsub/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

func GoodPublish() {
	p := &pubsub.Publisher{}
	attrs := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(nil, attrs)
	p.Publish(nil, nil)
}
