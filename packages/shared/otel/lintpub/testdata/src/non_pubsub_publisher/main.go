// Fixture: a LOCAL type named Publisher with a Publish method, defined
// outside the pubsub SDK package. The analyzer must NOT flag — its
// package-path check in isPubsubSDKPublish rules out non-SDK types
// regardless of name. Covers the `pkgPath == pubsubV1Path || ...`
// false branch.
package non_pubsub_publisher

type Publisher struct{}

func (p *Publisher) Publish(ctx, msg any) any { return nil }

func LocalPublisher() {
	p := &Publisher{}
	p.Publish(nil, nil) // not the SDK Publisher — analyzer must not flag
}
