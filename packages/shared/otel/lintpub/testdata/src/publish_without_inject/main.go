// Fixture: a function that publishes via the SDK Publisher *without*
// also calling propagator.Inject. The analyzer must flag the Publish
// line (marked by the `want` comment).
package publish_without_inject

import (
	pubsub "cloud.google.com/go/pubsub/v2"
)

func BadPublish() {
	p := &pubsub.Publisher{}
	p.Publish(nil, nil) // want `pubsub.Publisher.Publish called without propagator.Inject`
}
