// Fixture: the Inject call goes through a `GetTextMapPropagator()`
// getter whose package is NOT under go.opentelemetry.io/. This forces
// isPropagatorInject down Path 1-false then Path 2, where Path 2
// recognizes the call by the `GetTextMapPropagator` selector name.
// The Inject is credited, so the Publish must not be flagged — this
// file carries no expected-diagnostic directives.
package path2_inject_via_getter

import (
	pubsub "cloud.google.com/go/pubsub/v2"
	"localotel"
)

func PublishViaGetterInject() {
	p := &pubsub.Publisher{}
	localotel.GetTextMapPropagator().Inject(nil, nil)
	p.Publish(nil, nil)
}
