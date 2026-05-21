package lintpub

import (
	"go/ast"
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

// TestAnalyzer_FlagsEveryPublishCall — when a function has multiple
// Publish calls and no Inject, the analyzer must emit one diagnostic
// per Publish line (exercises the for-loop over `publishCalls`).
func TestAnalyzer_FlagsEveryPublishCall(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), Analyzer, "multiple_publishes_no_inject")
}

// TestAnalyzer_HandlesValueReceiverPublish — sel.X for a value
// receiver isn't wrapped in *types.Pointer, so isPubsubSDKPublish must
// handle the non-pointer branch correctly. Go auto-addresses the value
// to call the pointer-receiver Publish, but the type-checker still
// records the receiver as the value form.
func TestAnalyzer_HandlesValueReceiverPublish(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), Analyzer, "value_receiver_publish")
}

// TestAnalyzer_IgnoresNonSDKPublisher — a local type called Publisher
// with a Publish method (not from the pubsub SDK) must be ignored.
// Pins the package-path check that prevents flagging arbitrary types
// just because they happen to share the SDK's method name.
func TestAnalyzer_IgnoresNonSDKPublisher(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), Analyzer, "non_pubsub_publisher")
}

// TestAnalyzer_RejectsNonOTelInject — an `.Inject(...)` call on a
// local type that happens to be named Inject must not satisfy the
// Inject side of the pairing. Exercises Path 1 (otel-pkg check)
// returning false and Path 2 (GetTextMapPropagator chain) also
// returning false in isPropagatorInject.
func TestAnalyzer_RejectsNonOTelInject(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), Analyzer, "inject_on_unrelated_type")
}

// TestAnalyzer_IgnoresNonPublisherTypeWithPublishMethod — a type whose
// name is NOT Publisher (here, `Topic`) but which has a Publish method
// must not be flagged. Pins the `obj.Name() != "Publisher"` early-return
// branch in isPubsubSDKPublish, ensuring the check distinguishes by
// receiver type name, not by method name.
func TestAnalyzer_IgnoresNonPublisherTypeWithPublishMethod(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), Analyzer, "publish_on_non_publisher_type")
}

// Direct unit tests for the defensive nil-info branches in the helper
// functions. analysistest never invokes them with info=nil, so without
// these the defensive guards register as uncovered. The branches are
// belt-and-suspenders (go/analysis always passes a non-nil TypesInfo),
// but they exist so a future refactor that calls these helpers from a
// different context doesn't crash on a nil deref.

func TestIsPubsubSDKPublish_NilInfoReturnsFalse(t *testing.T) {
	sel := &ast.SelectorExpr{Sel: &ast.Ident{Name: "Publish"}}
	if isPubsubSDKPublish(nil, sel) {
		t.Error("expected false when info is nil")
	}
}

func TestIsPropagatorInject_NilInfoReturnsFalse(t *testing.T) {
	sel := &ast.SelectorExpr{Sel: &ast.Ident{Name: "Inject"}}
	if isPropagatorInject(nil, sel) {
		t.Error("expected false when info is nil")
	}
}
