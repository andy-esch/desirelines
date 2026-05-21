// Binary lintpub runs the lintpub trace-propagation analyzer
// (`packages/shared/otel/lintpub`) as a standalone go/analysis tool.
// Wired into `just go-lint` per-package and into the `go-quality` CI
// matrix. Build + run:
//
//	go build -o /tmp/lintpub ./packages/shared/cmd/lintpub
//	cd packages/dispatcher && /tmp/lintpub ./...
//
// Or via go vet's vettool protocol:
//
//	go vet -vettool=/tmp/lintpub ./...
package main

import (
	"golang.org/x/tools/go/analysis/singlechecker"

	"github.com/andy-esch/desirelines/packages/shared/otel/lintpub"
)

func main() {
	singlechecker.Main(lintpub.Analyzer)
}
