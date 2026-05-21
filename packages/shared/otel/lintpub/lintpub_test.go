package lintpub

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
)

// TestAnalyzer_FlagsPublishWithoutInject is the regression guard for the
// guard: a function that calls pubsub.Publisher.Publish without also
// calling propagator.Inject must trip the analyzer's diagnostic. The
// `// want` comment in the fixture is the expected diagnostic regex.
func TestAnalyzer_FlagsPublishWithoutInject(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), Analyzer, "publish_without_inject")
}

// TestAnalyzer_PassesPublishWithInject confirms the analyzer doesn't
// produce false positives: a function that pairs Publish with Inject
// in the same body must NOT trip a diagnostic.
func TestAnalyzer_PassesPublishWithInject(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), Analyzer, "publish_with_inject")
}
