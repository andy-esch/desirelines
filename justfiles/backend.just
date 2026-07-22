# Run Python tests (default: uv pytest, use --pants for Pants)
py-test +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Running Python tests with Pants..."
        pants test packages/stravapipe::
    else
        echo "🐍 Running Python tests with uv (fast)..."
        cd packages/stravapipe && uv run pytest tests/ {{args}}
    fi

# Run Python linter (default: Ruff fix, use --pants for Pants)
py-lint +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Linting Python with Pants..."
        pants lint packages/stravapipe::
    else
        echo "🐍 Linting Python with Ruff (fast)..."
        cd packages/stravapipe && uv run ruff check . --fix {{args}}
    fi

# Format Python code (default: Ruff format, use --pants for Pants)
py-format +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Formatting Python with Pants..."
        pants fmt packages/stravapipe::
    else
        echo "🐍 Formatting Python with Ruff (fast)..."
        cd packages/stravapipe && uv run ruff format . {{args}}
    fi

# Run Python type checking (default: mypy, use --pants for Pants)
py-typecheck +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Running Python type checking with Pants..."
        pants check packages/stravapipe::
    else
        echo "🐍 Running Python type checking with mypy (fast)..."
        # Include tests/ so the local check matches pants' scope —
        # previously this only ran on src/ and let test-only type
        # errors slip through to CI.
        cd packages/stravapipe && uv run mypy src/ tests/ {{args}}
    fi

# Emit `[ruff] known_versions` rows for pants.toml.
#
# Pants runs ruff as a downloaded binary, so it can't read the version from
# the resolve the way pytest/mypy do via `install_from_resolve`. The version
# is pinned in `pants.toml` instead, and Pants verifies the download against
# a sha256 it only ships for versions it knows about (through 0.15.5 as of
# Pants 2.32). Any newer pin needs its own rows, or `pants lint` fails with
# an unknown-version error.
#
# Run this after Renovate bumps ruff in pyproject.toml, then paste the output
# over the `known_versions` list in pants.toml and update `version` to match.
# Keeping the two in lockstep is what stops `pants lint` (CI) and
# `uv run ruff` (local) from reporting different diagnostics.
ruff-hashes version:
    #!/usr/bin/env bash
    set -euo pipefail
    # Platform keys are Pants'; the tuples are ruff's release asset names.
    # NB. musl not gnu, matching Pants' own default mapping.
    for pair in "linux_arm64 :aarch64-unknown-linux-musl" \
                "linux_x86_64:x86_64-unknown-linux-musl" \
                "macos_arm64 :aarch64-apple-darwin" \
                "macos_x86_64:x86_64-apple-darwin"; do
        plat="${pair%%:*}"
        asset="ruff-${pair##*:}.tar.gz"
        url="https://github.com/astral-sh/ruff/releases/download/{{version}}/${asset}"
        tmp="$(mktemp)"
        if ! curl -sfL -o "$tmp" "$url"; then
            echo "❌ Could not download ${url}" >&2
            rm -f "$tmp"
            exit 1
        fi
        printf '  "%s|%s|%s|%s",\n' \
            "{{version}}" "$plat" \
            "$(shasum -a 256 "$tmp" | cut -d' ' -f1)" \
            "$(wc -c < "$tmp" | tr -d ' ')"
        rm -f "$tmp"
    done

# Emit `[golangci-lint] known_versions` rows for pants.toml.
#
# Same problem as `ruff-hashes`: Pants verifies the download against a sha256
# it only ships for versions it knows about (through 2.7.1 as of Pants 2.32),
# so any newer pin needs its own rows.
#
# golangci-lint supports Go versions <= the Go it was built with, so this has
# to be bumped whenever the toolchain moves. Check with:
#   golangci-lint version   # -> "built with go1.XX.Y"
golangci-hashes version:
    #!/usr/bin/env bash
    set -euo pipefail
    # Platform keys are Pants'; the tuples are golangci-lint's release asset
    # names. Must match `url_platform_mapping` in pants.toml.
    for pair in "macos_x86_64:darwin-amd64" \
                "macos_arm64 :darwin-arm64" \
                "linux_x86_64:linux-amd64" \
                "linux_arm64 :linux-arm64"; do
        plat="${pair%%:*}"
        asset="golangci-lint-{{version}}-${pair##*:}.tar.gz"
        url="https://github.com/golangci/golangci-lint/releases/download/v{{version}}/${asset}"
        tmp="$(mktemp)"
        if ! curl -sfL -o "$tmp" "$url"; then
            echo "❌ Could not download ${url}" >&2
            rm -f "$tmp"
            exit 1
        fi
        printf '  "%s|%s|%s|%s",\n' \
            "{{version}}" "$plat" \
            "$(shasum -a 256 "$tmp" | cut -d' ' -f1)" \
            "$(wc -c < "$tmp" | tr -d ' ')"
        rm -f "$tmp"
    done

# Workspace members — keep in sync with `go.work`'s `use (...)` block.
# Consumed by go-tidy-{check,fix}; single source of truth so a new
# member only needs to be added in one place per task.
go_workspace_members := "packages/apigateway packages/dispatcher packages/shared scripts/ops/backfills"

# Run Go tests (default: go test, use --pants for Pants)
go-test +args='':
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Running Go tests with Pants..."
        pants test packages/dispatcher:: packages/apigateway:: packages/shared::
    else
        echo "🐹 Running Go tests with native go (fast)..."
        echo "   Testing dispatcher..."
        # Execute in a subshell (...) to isolate directory changes
        (cd packages/dispatcher && go test -v ./... {{args}})
        echo "   Testing apigateway..."
        (cd packages/apigateway && go test -v ./... {{args}})
        echo "   Testing shared..."
        (cd packages/shared && go test -v ./... {{args}})
    fi

# Run Go linter (default: golangci-lint + lintpub, use --pants for Pants)
go-lint +args='':
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Linting Go with Pants..."
        pants lint packages/dispatcher:: packages/apigateway:: packages/shared::
    else
        echo "🐹 Linting Go with golangci-lint (fast)..."
        golangci-lint run ./packages/dispatcher/... ./packages/apigateway/... ./packages/shared/... {{args}}
        just go-lintpub
    fi

# Run only the trace-propagation analyzer (lintpub). Faster than the
# full `go-lint` when you just want to check the Publish/Inject pairing
# while iterating on a publish path. CI invokes this same binary via
# `.github/workflows/ci.yml` (see go-quality job).
#
# Flags any *pubsub.Publisher.Publish(...) call without a paired
# propagator.Inject in the same function, so missing trace-context
# injection on a new publish path is caught at PR time.
go-lintpub:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔎 Running trace-propagation analyzer (lintpub)..."
    lintpub_bin="$(mktemp -d)/lintpub"
    (cd packages/shared && go build -o "$lintpub_bin" ./cmd/lintpub)
    for pkg in dispatcher apigateway shared; do
        (cd "packages/$pkg" && "$lintpub_bin" ./...)
    done

# Verify all Go module files in the workspace are tidy. Fails if any
# member's go.mod / go.sum has drifted from what `go mod tidy` would
# produce, or if `go.work.sum` needs an update. Wire into CI so drift
# is caught at PR time instead of on a contributor's machine.
#
# Renovate updates ONE go.mod per PR with `go mod tidy` for that
# module only; it does not run `go work sync` or tidy other members.
# After a Renovate merge, transitively-pulled bumps surface as drift
# in the other members — that's the failure mode this gate catches.
go-tidy-check:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🐹 Checking Go module tidiness across workspace members..."
    for pkg in {{go_workspace_members}}; do
        echo "   → $pkg"
        # `go mod tidy -diff` (Go 1.23+) exits non-zero if go.mod or
        # go.sum would change. Prints the diff to stdout for the log.
        (cd "$pkg" && go mod tidy -diff) || {
            echo "❌ $pkg is not tidy. Run 'just go-tidy-fix' and commit."
            exit 1
        }
    done
    echo "🐹 Checking go workspace (go.work / go.work.sum + member go.mod sync)..."
    go work sync
    # `go work sync` writes the MVS-resolved version of every transitive
    # dep back into each member's go.mod (per `go help work sync`), so a
    # filter limited to go.work/go.work.sum would miss those edits. Scope
    # the diff to every go.* file — catches member-level drift while
    # ignoring unrelated working-tree changes a contributor may have.
    if ! git diff --exit-code -- 'go.work' 'go.work.sum' '**/go.mod' '**/go.sum'; then
        echo "❌ Go workspace is out of sync. Run 'just go-tidy-fix' and commit."
        exit 1
    fi
    echo "✓ All Go workspace members + go.work.sum are tidy."

# Apply `go mod tidy` to every workspace member + `go work sync` —
# the "one button" fix for drift surfaced by `go-tidy-check`. Mutates
# the working tree; review and commit the diff.
go-tidy-fix:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🐹 Tidying every Go workspace member..."
    for pkg in {{go_workspace_members}}; do
        echo "   → $pkg"
        (cd "$pkg" && go mod tidy)
    done
    echo "🐹 Syncing go workspace..."
    go work sync
    echo "✓ Done. Review with 'git diff' and commit."

# Format Go code (default: go fmt, use --pants for Pants)
go-format +args='':
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Formatting Go with Pants..."
        pants fmt packages/dispatcher:: packages/apigateway:: packages/shared::
    else
        echo "🐹 Formatting Go with native go fmt (fast)..."
        # Execute in a subshell (...) to isolate directory changes
        (cd packages/dispatcher && go fmt ./...)
        (cd packages/apigateway && go fmt ./...)
        (cd packages/shared && go fmt ./...)
    fi

# Generate the BQ activities .proto file from the BigQuery JSON schema.
# Source of truth: schemas/bigquery/activities_full.json
# Output: schemas/proto/desirelines/bigquery/v1/bq_activities.proto
# Pants picks up the generated .proto via its protobuf_sources target.
#
# Uses plain `python3` (not `uv run`) because the generator is stdlib-only
# and this recipe is invoked from CI's lightweight validation job, which
# doesn't install uv. Any Python 3.11+ on PATH works.
generate-bq-proto:
    @echo "🔨 Generating BQ activities .proto from JSON schema..."
    @python3 schemas/bigquery/generate_proto.py

# Generate Python/Go protos via Pants and sync to source tree
proto-gen-backend: generate-bq-proto
    @echo "🔨 Generating Go & Python code with Pants..."
    pants export-codegen schemas/proto::
    @echo "📋 Syncing generated code to source tree..."
    # Python: Copy sports_metrics, webhook, and BQ activities protos to stravapipe
    @mkdir -p packages/stravapipe/src/stravapipe/types/generated
    @find dist/codegen/schemas/proto -name "sports_metrics_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
    @find dist/codegen/schemas/proto -name "webhook_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
    @find dist/codegen/schemas/proto -name "bq_activities_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
    @touch packages/stravapipe/src/stravapipe/types/generated/__init__.py
    # Go: Copy .pb.go files to apigateway and dispatcher
    @mkdir -p packages/apigateway/types/generated packages/apigateway/types/generated/activitiesv1 packages/dispatcher/types/generated
    @find dist/codegen/schemas/proto \( -name "sports_metrics.pb.go" -o -name "user_config.pb.go" \) -exec cp {} packages/apigateway/types/generated/ \;
    @find dist/codegen/schemas/proto -name "activities.pb.go" -exec cp {} packages/apigateway/types/generated/activitiesv1/ \;
    @find dist/codegen/schemas/proto -name "webhook.pb.go" -exec cp {} packages/dispatcher/types/generated/ \;
    @echo "✅ Backend generation complete"

# Regenerate protos and sync JSON configs
sync-schemas: proto-gen-backend sync-sport-config
    @echo "✅ All schemas synced"

# Validate the bq-inserter's proto schema against a real BQ table.
# Catches descriptor-shape issues (proto3_optional, unresolved nested
# type names, name/type drift) that the BQ Storage Write API only
# surfaces server-side after a deploy. Requires ADC.
#
# Usage:
#   just bq-validate-schema                 # validates against desirelines-dev
#   just bq-validate-schema desirelines-prod
bq-validate-schema project='desirelines-dev':
    @cd packages/stravapipe && uv run python -m stravapipe.tools.validate_bq_storage_schema \
        --project {{project}}

# Sync sport_types.json to all backend packages
sync-sport-config:
    @echo "📋 Syncing sport config to packages..."
    @mkdir -p packages/stravapipe/src/stravapipe/config
    @mkdir -p packages/apigateway/config
    @cp schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/
    @cp schemas/sports/sport_types.json packages/apigateway/config/
    @echo "✅ Sport config synced"

# Diff Strava's upstream SportType enum against schemas/sports/sport_types.json.
# Surfaces sports Strava added before we registered them. Stdlib-only Python.
#
# Default mode warns but exits 0; `just check-upstream-sports --strict` exits
# non-zero on drift (suitable for a scheduled CI job that posts to Slack).
check-upstream-sports +args='':
    @echo "🔍 Diffing Strava SportType enum against schemas/sports/sport_types.json..."
    @python3 scripts/ops/check-strava-sports.py {{args}}

# Verify both webhook adapters handle all proto fields and enum values
verify-webhook-adapters:
    @./scripts/verify-webhook-adapters.sh

# Verify schema files are in sync (used in CI)
verify-schemas: verify-webhook-adapters
    @echo "🔍 Verifying schemas are in sync..."
    @diff -q schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/sport_types.json || \
        (echo "❌ stravapipe sport config out of sync! Run: just sync-sport-config" && exit 1)
    @diff -q schemas/sports/sport_types.json packages/apigateway/config/sport_types.json || \
        (echo "❌ apigateway sport config out of sync! Run: just sync-sport-config" && exit 1)
    @echo "🔍 Verifying BQ proto matches BQ JSON schema..."
    @python3 schemas/bigquery/generate_proto.py --check
    @echo "✅ All schemas in sync"

# Lint protobuf files using 'buf'
proto-lint:
    @echo "🔍 Linting protobuf files..."
    buf lint schemas/proto

# Check protobuf files for breaking changes against main
proto-breaking:
    @echo "🔍 Checking for breaking protobuf changes..."
    buf breaking schemas/proto --against '.git#branch=main,subdir=schemas/proto'

# Format protobuf files using 'buf'
proto-fmt:
    @echo "🎨 Formatting protobuf files..."
    buf format -w schemas/proto

# Verify protobuf files are buf-formatted, without mutating the working tree.
# Exits non-zero with the diff printed if any file needs reformatting.
#
# This also guards a subtler trap: bq_activities.proto is GENERATED
# (schemas/bigquery/generate_proto.py) but still lives under schemas/proto, so
# `buf format` rewrites it too. If the generator's output ever drifts from buf's
# canonical form, `just format` silently dirties the file and the next
# `just verify-schemas` fails with a confusing "BQ proto out of sync". Catching
# it here names the real cause at PR time instead.
proto-fmt-check:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🎨 Checking proto formatting with buf..."
    if ! buf format -d --exit-code schemas/proto; then
        echo "❌ Protos not formatted. Run 'just proto-fmt' and commit."
        echo "   If the diff is in a GENERATED proto (e.g. bq_activities.proto),"
        echo "   fix the generator's output instead — see generate_proto.py."
        exit 1
    fi
