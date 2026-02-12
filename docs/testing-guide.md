# Testing Guide

This guide covers all testing workflows using Pants build system.

## Quick Start

```bash
# Run all tests (Python + Go)
pants test ::

# Run tests for specific package
pants test packages/stravapipe::
pants test packages/dispatcher::
pants test packages/apigateway::

# Run specific test file
pants test packages/stravapipe/tests/test_config.py
```

## Test Workflows

### Run All Tests

Run all tests across all languages (Python + Go):

```bash
pants test ::
```

**Performance:**

- First run: ~60s (building cache)
- Subsequent runs: ~1.7s (90% faster with caching!)

### Test Specific Package

```bash
# Python package
pants test packages/stravapipe::

# Go packages
pants test packages/dispatcher::
pants test packages/apigateway::
```

### Test Only What Changed

One of Pants' killer features - only test code affected by your changes:

```bash
# Test changes since main branch
pants --changed-since=origin/main test

# Test changes since HEAD (uncommitted changes)
pants --changed-since=HEAD test

# Test changes since specific commit
pants --changed-since=abc123 test
```

**How it works:**

- Pants analyzes file changes and dependency graph
- Only runs tests that could be affected by your changes
- Includes cross-language dependencies (e.g., proto changes → Python + Go tests)

**Example:**

```bash
# You changed packages/stravapipe/src/stravapipe/utils.py
pants --changed-since=HEAD test
# → Only runs stravapipe tests, skips Go tests
```

### Test with Coverage

Generate coverage reports for Python tests:

```bash
# Run tests with coverage
pants test --use-coverage packages/stravapipe::

# Coverage reports are generated at:
# - dist/coverage/python/coverage.xml (for CI tools)
# - Console output (summary table)
```

**Current coverage:** 90% on stravapipe package

### Run Specific Test File or Function

```bash
# Specific test file
pants test packages/stravapipe/tests/test_config.py

# Specific test function (use pytest syntax)
pants test packages/stravapipe/tests/test_config.py -- -k test_load_config
```

### Debug Test Failures

Show all test output (not just failures):

```bash
pants test --test-output=all packages/stravapipe::
```

### Watch Mode (Re-run on Changes)

Automatically re-run tests when files change:

```bash
pants test --loop packages/stravapipe::
```

## Performance Comparison

| Scenario | Traditional (Native) | Pants (first) | Pants (cached) | Speedup |
|----------|----------|---------------|----------------|---------|
| Python tests | 3.5s | ~60s | 1.7s | **2x faster** |
| All tests | ~65s | ~90s | ~10s | **6.5x faster** |
| Changed only | Manual | N/A | ~5-30s | **Massive** |

**Key benefits:**

- ✅ Caching makes repeat runs **2-6x faster**
- ✅ Changed detection only tests affected code
- ✅ Cross-language dependency tracking (proto → Python + Go)
- ✅ Single unified command for all languages

## Test Configuration

Configuration in `pants.toml`:

```toml
[test]
use_coverage = false  # Enable with --use-coverage flag
timeout_default = 60  # Default timeout (seconds)
timeout_maximum = 300  # Maximum timeout (seconds)
output = "failed"  # Only show failed test output

[pytest]
args = ["-v", "--tb=short"]  # Verbose with short tracebacks

[go-test]
args = ["-v"]  # Verbose output
# Note: -race flag not supported by Pants Go backend

[coverage-py]
report = ["console", "xml"]  # Generate console + XML reports
output_dir = "{distdir}/coverage/python"  # Coverage output directory
```

## Common Issues

### First run is slow

**Cause:** Pants is building its cache of dependencies and test environments.

**Solution:** This is expected. Subsequent runs will be much faster (~90% improvement).

### Tests not discovered

**Check:**

1. BUILD files exist for test directories
2. Test file naming matches patterns:
   - Python: `test_*.py` or `*_test.py`
   - Go: `*_test.go`

### Coverage not generating

**Ensure:**

1. Using `--use-coverage` flag (not `--coverage-py`)
2. Coverage configuration exists in `pants.toml`:

   ```toml
   [coverage-py]
   report = ["console", "xml"]
   ```

### Changed detection not working

**Verify:**

1. You're in a git repository
2. Comparing to valid ref: `pants --changed-since=origin/main test`
3. Changes are uncommitted (or comparing to earlier commit)

## CI Integration

Example GitHub Actions workflow:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run all tests
        run: pants test ::

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: dist/coverage/python/coverage.xml
```

## Just Integration

You can use `just` as a convenient wrapper for testing, which supports both native tools (default) and Pants:

```bash
# Run tests using native tools (uv, go, npm) - fast for small changes
just test
just py-test
just go-test

# Use --pants flag to run via Pants (leveraging caching)
just test --pants
just py-test --pants
```

**Recommendation:** Use `just` for daily workflows and `pants` directly for advanced features like change detection or debugging.

## Advanced Features

### Test Sharding (for CI parallelization)

Split tests across multiple CI workers:

```bash
# Worker 1 of 4
pants test --shard=0/4 ::

# Worker 2 of 4
pants test --shard=1/4 ::

# etc.
```

### Remote Caching (Coming in Phase 7)

Enable remote caching for even faster CI:

```bash
# Share cache across team and CI
pants --remote-cache-read --remote-cache-write test ::
```

### Filter by Tag

Tag tests in BUILD files and filter:

```bash
# Tag tests
python_tests(
    name="tests",
    sources=["test_*.py"],
    tags=["integration"],
)

# Run only integration tests
pants test --tag=integration ::
```

## Summary

**Key Commands:**

```bash
pants test ::                          # All tests
pants test packages/stravapipe::       # Specific package
pants --changed-since=main test        # Only changed
pants test --use-coverage ::           # With coverage
pants test --loop packages/stravapipe::  # Watch mode
```

**Why Pants?**

- 🚀 **90% faster** on repeat runs (caching)
- 🎯 **Smart test selection** (changed detection)
- 🔗 **Cross-language aware** (proto changes → all tests)
- 📊 **Unified coverage** across all languages
- ⚡ **Parallel execution** by default
