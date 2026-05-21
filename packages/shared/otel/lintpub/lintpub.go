// Package lintpub provides a go/analysis Analyzer that flags any
// `(*pubsub.Publisher).Publish(...)` call site whose enclosing function
// does not also invoke an OTel propagator's `Inject(...)`. That pairing
// is the contract that lets a `traceparent` attribute end up on the
// outgoing message — without it, downstream Python services receive a
// message with no trace context to extract, and the cross-service
// trace silently breaks.
//
// This is the "G1" guard from the trace-propagation regression task
// (`desirelines-planning/tasks/in-progress/e2e-trace-propagation-test.md`).
// It runs as a standalone `go vet`-style binary via the cmd/lintpub
// singlechecker, plumbed into `just go-lint` and the `go-quality` CI
// matrix.
//
// What it flags:
//
//   - Direct method calls of the form `X.Publish(...)` where `X`'s type
//     is `*cloud.google.com/go/pubsub/v2.Publisher` (the SDK Publisher
//     this codebase uses; the v1 path is also accepted defensively).
//   - In a function body that does not also contain an `Inject(...)`
//     call rooted at `propagation.TextMapPropagator` (per OTel's type)
//     or returned by `otel.GetTextMapPropagator()` / any local alias.
//
// What it does NOT flag:
//
//   - Calls to *our* `pubsub.Publisher.Publish` wrapper in
//     `packages/dispatcher/adapters/pubsub/publisher.go` — that's the
//     function that *contains* the contract and is itself analyzed
//     here. Any caller of the wrapper trusts that wrapper to inject.
//   - Test files (`*_test.go`) — tests may legitimately exercise
//     Publish in isolation. Adjust via the `-skip-tests=false` flag if
//     you want to also lint test code.
//
// Known limits:
//
//   - Only catches Inject calls inside the SAME function as Publish.
//     A function that publishes and delegates injection to a helper
//     (e.g. `func myPublish() { inject(ctx, attrs); pub.Publish(...) }`)
//     would pass; one that helper-extracted the inject to a different
//     function would falsely flag.
//   - Doesn't track data flow — if a function injects into `attrs1` but
//     publishes with `attrs2`, the analyzer says "fine" because both
//     calls are present. Pragma: the realistic regression is "forgot
//     to call Inject at all," not "called Inject on the wrong map."
package lintpub

import (
	"errors"
	"flag"
	"go/ast"
	"go/types"
	"strings"

	"golang.org/x/tools/go/analysis"
	"golang.org/x/tools/go/analysis/passes/inspect"
	"golang.org/x/tools/go/ast/inspector"
)

const (
	// Package paths recognized as "the SDK Publisher" — used in
	// isPubsubSDKPublish for an exact-match check on the receiver type's
	// package. v2 is what the codebase actually uses; v1 is accepted
	// defensively in case a stray import or vendored fork sneaks in.
	pubsubV1Path = "cloud.google.com/go/pubsub"
	pubsubV2Path = "cloud.google.com/go/pubsub/v2"

	// Recognized Inject prefix — the broader "go.opentelemetry.io/" tree
	// covers any TextMapPropagator implementation regardless of which
	// specific OTel sub-package it lives in. See isPropagatorInject.
	otelPkgPathPrefix = "go.opentelemetry.io/"
)

// Analyzer is the go/analysis registration. Plug into singlechecker.Main
// (see cmd/lintpub) or into a multichecker alongside other custom checks.
var Analyzer = &analysis.Analyzer{
	Name:     "lintpub",
	Doc:      "checks that pubsub.Publisher.Publish calls are paired with OTel propagator.Inject in the same function (so traceparent reaches downstream consumers)",
	Run:      run,
	Requires: []*analysis.Analyzer{inspect.Analyzer},
	Flags:    flagSet(),
}

var skipTests = true

func flagSet() flag.FlagSet {
	fs := flag.NewFlagSet("lintpub", flag.ExitOnError)
	fs.BoolVar(&skipTests, "skip-tests", true, "skip files ending in _test.go (default true)")
	return *fs
}

func run(pass *analysis.Pass) (any, error) {
	insp, ok := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
	if !ok {
		// Should not happen — Requires lists inspect.Analyzer and the
		// framework guarantees its ResultOf entry is *inspector.Inspector.
		// Belt-and-suspenders to satisfy errcheck's check-type-assertions.
		return nil, errors.New("lintpub: inspect.Analyzer result is not *inspector.Inspector")
	}

	// Walk every function body (declarations and literals — closures count too).
	nodeFilter := []ast.Node{
		(*ast.FuncDecl)(nil),
		(*ast.FuncLit)(nil),
	}

	insp.Preorder(nodeFilter, func(n ast.Node) {
		var body *ast.BlockStmt
		switch fn := n.(type) {
		case *ast.FuncDecl:
			body = fn.Body
		case *ast.FuncLit:
			body = fn.Body
		}
		if body == nil {
			return
		}
		if skipTests {
			file := pass.Fset.File(n.Pos())
			if file != nil && strings.HasSuffix(file.Name(), "_test.go") {
				return
			}
		}

		publishCalls, hasInject := scanBody(pass.TypesInfo, body)
		if len(publishCalls) > 0 && !hasInject {
			for _, call := range publishCalls {
				pass.Reportf(call.Pos(),
					"pubsub.Publisher.Publish called without propagator.Inject in the same function — "+
						"trace context will not propagate to downstream consumers. "+
						"Inject before constructing the message, e.g.: "+
						"otel.GetTextMapPropagator().Inject(ctx, propagation.MapCarrier(attrs)) "+
						"(translate `otel` to whatever your local import alias is)")
			}
		}
	})

	return nil, nil
}

// scanBody walks a function body, returning (a) every direct
// pubsub.Publisher.Publish call it finds and (b) whether any Inject call
// matching our propagator contract is also present. Both halves of the
// pair are necessary; the diagnostic fires when Publish is present but
// Inject is not.
func scanBody(info *types.Info, body *ast.BlockStmt) ([]*ast.CallExpr, bool) {
	var publishes []*ast.CallExpr
	var sawInject bool

	ast.Inspect(body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		switch sel.Sel.Name {
		case "Publish":
			if isPubsubSDKPublish(info, sel) {
				publishes = append(publishes, call)
			}
		case "Inject":
			if isPropagatorInject(info, sel) {
				sawInject = true
			}
		}
		return true
	})

	return publishes, sawInject
}

// isPubsubSDKPublish reports whether the selector is a method call on
// `*cloud.google.com/go/pubsub.Publisher` (v1) or
// `*cloud.google.com/go/pubsub/v2.Publisher` — i.e. the SDK Publisher,
// not an arbitrary local type that happens to have a Publish method.
func isPubsubSDKPublish(info *types.Info, sel *ast.SelectorExpr) bool {
	if info == nil {
		return false
	}
	tv, tvOK := info.Types[sel.X]
	if !tvOK {
		return false
	}
	t := tv.Type
	if t == nil {
		return false
	}
	// Receiver may be a pointer — unwrap.
	if ptr, ptrOK := t.(*types.Pointer); ptrOK {
		t = ptr.Elem()
	}
	named, namedOK := t.(*types.Named)
	if !namedOK {
		return false
	}
	obj := named.Obj()
	if obj == nil || obj.Pkg() == nil {
		return false
	}
	if obj.Name() != "Publisher" {
		return false
	}
	pkgPath := obj.Pkg().Path()
	return pkgPath == pubsubV1Path || pkgPath == pubsubV2Path
}

// isPropagatorInject reports whether the selector is an OTel propagator
// Inject call. Recognizes two shapes:
//
//   - `propagation.TextMapPropagator.Inject(...)` — the method directly
//     on an OTel-package type (resolved via TypesInfo).
//   - `otel.GetTextMapPropagator().Inject(...)` — the very common
//     getter chain (recognized syntactically as a hedge against the
//     OTel SDK's interface re-exports occasionally confusing
//     TypesInfo).
func isPropagatorInject(info *types.Info, sel *ast.SelectorExpr) bool {
	if info == nil {
		return false
	}
	// Path 1: the method's defining package is otel/* (covers any
	// TextMapPropagator implementation living under go.opentelemetry.io).
	if obj := info.ObjectOf(sel.Sel); obj != nil && obj.Pkg() != nil {
		if strings.HasPrefix(obj.Pkg().Path(), otelPkgPathPrefix) {
			return true
		}
	}
	// Path 2: receiver expression is a `*.GetTextMapPropagator()` call.
	// Covers both `otel.GetTextMapPropagator()` and aliased imports
	// like `otelglobal.GetTextMapPropagator()`.
	if inner, innerOK := sel.X.(*ast.CallExpr); innerOK {
		if innerSel, selOK := inner.Fun.(*ast.SelectorExpr); selOK {
			if innerSel.Sel.Name == "GetTextMapPropagator" {
				return true
			}
		}
	}
	return false
}
