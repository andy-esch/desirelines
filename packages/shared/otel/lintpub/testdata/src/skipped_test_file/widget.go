// Non-test file in the same fixture package: its Publish-without-Inject
// MUST be flagged (proves the analyzer runs on production files).
package skipped_test_file

import (
	pubsub "cloud.google.com/go/pubsub/v2"
)

func ProductionPublish() {
	p := &pubsub.Publisher{}
	p.Publish(nil, nil) // want `pubsub.Publisher.Publish called without propagator.Inject`
}
