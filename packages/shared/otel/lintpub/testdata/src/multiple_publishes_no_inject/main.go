// Fixture: a function with several SDK Publish calls and no Inject.
// The analyzer must flag *each* Publish line independently — covers the
// `for _, call := range publishCalls` loop in run().
package multiple_publishes_no_inject

import (
	pubsub "cloud.google.com/go/pubsub/v2"
)

func ThreeBadPublishes() {
	p := &pubsub.Publisher{}
	p.Publish(nil, nil) // want `pubsub.Publisher.Publish called without propagator.Inject`
	p.Publish(nil, nil) // want `pubsub.Publisher.Publish called without propagator.Inject`
	p.Publish(nil, nil) // want `pubsub.Publisher.Publish called without propagator.Inject`
}
