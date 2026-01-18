set dotenv-load

# Import domain modules
import 'justfiles/backend.just'
import 'justfiles/web.just'
import 'justfiles/db.just'
import 'justfiles/tf.just'
import 'justfiles/ops.just'
import 'justfiles/gcp.just'
import 'justfiles/scripts.just'

# List all available commands
default:
    @just --list

# Alias for 'just --list'
help:
    @just --list

# ==========================================
# Core Developer Workflow
# ==========================================

# Run all tests across Python, Go, and Web
test: py-test go-test web-test

# Run all linters (Ruff, golangci-lint, ESLint, buf)
lint: py-lint go-lint web-lint proto-lint sh-lint

# Format all code (Ruff, go fmt, Prettier, buf, terraform fmt)
format: py-format go-format web-format proto-fmt tf-fmt sh-format

# Run all type checkers (Python, web)
typecheck: py-typecheck web-typecheck

# ==========================================
# Protocol Buffers (Aggregate)
# ==========================================

# Generate all protobuf schemas (Backend + Web)
proto-gen: proto-gen-backend proto-gen-web
    @echo "✅ All schemas generated"
