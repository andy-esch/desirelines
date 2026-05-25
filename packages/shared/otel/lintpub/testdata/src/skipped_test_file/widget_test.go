// A _test.go file with a Publish-without-Inject and no
// expected-diagnostic directive. With the analyzer's default
// skip-tests behavior this file must be skipped entirely —
// analysistest fails if the analyzer emits any diagnostic here, so a
// clean run is the assertion that test files are not linted.
//
// `helperPublish` is deliberately not a Test/Benchmark function (no
// *testing.T param) — it's a plain function that just happens to live
// in a _test.go file, which is exactly the file-suffix case the
// skip-tests check keys on.
package skipped_test_file

import (
	pubsub "cloud.google.com/go/pubsub/v2"
)

func helperPublish() {
	p := &pubsub.Publisher{}
	p.Publish(nil, nil)
}
