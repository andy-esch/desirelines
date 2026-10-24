#!/usr/bin/env bash
# Compatibility entry point; procedure: docs/runbooks/dlq-redrive.md.
set -euo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/dlq_replay.py" "$@"
