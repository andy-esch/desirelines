// Fixture: a type that's NOT named Publisher but has a method called
// Publish. The analyzer must not flag — covers the
// `obj.Name() != "Publisher"` early-return branch in isPubsubSDKPublish,
// pinning that the check distinguishes by type name, not method name.
package publish_on_non_publisher_type

type Topic struct{}

func (t *Topic) Publish(ctx, msg any) any { return nil }

func PublishOnTopic() {
	tt := &Topic{}
	tt.Publish(nil, nil) // method named Publish, but receiver type isn't Publisher
}
