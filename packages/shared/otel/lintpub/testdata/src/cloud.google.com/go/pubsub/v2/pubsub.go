// Stub of cloud.google.com/go/pubsub/v2 for analysistest fixtures.
// The analyzer matches Publisher by its (package path, type name);
// this stub provides both at the right paths so testdata fixtures can
// import "cloud.google.com/go/pubsub/v2" and look real to the
// type-checker. Only the surface the fixtures call is implemented.
package pubsub

type Publisher struct{}

func (p *Publisher) Publish(ctx any, msg any) any { return nil }
