// Fixture: SDK Publisher accessed by VALUE (not pointer) — exercises
// the `else` branch of the pointer-unwrap in isPubsubSDKPublish (where
// tv.Type is *types.Named directly, not wrapped in *types.Pointer).
//
// Go auto-addresses the value when calling a pointer-receiver method,
// but the type-checker still records sel.X's type as the value form,
// so the analyzer's pointer check must handle both shapes.
package value_receiver_publish

import (
	pubsub "cloud.google.com/go/pubsub/v2"
)

func ValuePublish() {
	p := pubsub.Publisher{}
	p.Publish(nil, nil) // want `pubsub.Publisher.Publish called without propagator.Inject`
}
