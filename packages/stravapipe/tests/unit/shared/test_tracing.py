"""Unit tests for the shared tracing module."""

import pytest

from stravapipe.shared.tracing import (
    extract_context_from_attributes,
    record_span,
    setup_tracing,
    shutdown_tracing,
)


class TestSetupTracing:
    """Tests for setup_tracing env var gating."""

    def test_returns_noop_tracer_when_disabled(self, monkeypatch):
        """When ENABLE_OTEL_TRACING is not set, returns a no-op tracer."""
        monkeypatch.delenv("ENABLE_OTEL_TRACING", raising=False)
        tracer = setup_tracing("test-service")
        # No-op tracer still creates spans (they just don't export)
        assert tracer is not None

    def test_returns_noop_tracer_when_false(self, monkeypatch):
        monkeypatch.setenv("ENABLE_OTEL_TRACING", "false")
        tracer = setup_tracing("test-service")
        assert tracer is not None


class TestExtractContextFromAttributes:
    """Tests for W3C traceparent extraction."""

    def test_returns_none_without_traceparent(self):
        attrs = {"correlation_id": "abc-123"}
        assert extract_context_from_attributes(attrs) is None

    def test_returns_none_for_empty_attributes(self):
        assert extract_context_from_attributes({}) is None

    def test_returns_context_with_traceparent(self):
        attrs = {
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            "correlation_id": "abc-123",
        }
        ctx = extract_context_from_attributes(attrs)
        assert ctx is not None

    def test_extracted_context_carries_injected_trace_id(self):
        """Round-trip contract: trace-id in the inbound `traceparent` attr
        must surface as the active span context's trace-id in the extracted
        Context.

        Cross-service propagation contract test — pairs with the Go
        publisher's `TestPublish_InjectsTraceparentMatchingActiveSpan`.
        Catches the regression class "someone refactored
        `extract_context_from_attributes` to swallow the traceparent and
        return a fresh/empty context" — which the existing
        `is not None` assertion would not catch.
        """
        from opentelemetry.trace import get_current_span

        # Distinctive ids we can recognize on the other side.
        trace_id_hex = "0af7651916cd43dd8448eb211c80319c"
        span_id_hex = "b7ad6b7169203331"
        attrs = {"traceparent": f"00-{trace_id_hex}-{span_id_hex}-01"}

        ctx = extract_context_from_attributes(attrs)
        assert ctx is not None

        span = get_current_span(ctx)
        sc = span.get_span_context()
        # OTel API returns ints; format back to 32/16-char zero-padded hex
        # so the round-trip is unambiguous regardless of value width.
        assert f"{sc.trace_id:032x}" == trace_id_hex
        assert f"{sc.span_id:016x}" == span_id_hex

    def test_returns_context_with_invalid_traceparent(self):
        """Invalid traceparent still returns a context (OTel handles gracefully)."""
        attrs = {"traceparent": "invalid"}
        ctx = extract_context_from_attributes(attrs)
        # OTel returns a context even with invalid traceparent
        assert ctx is not None


class TestRecordSpan:
    """Tests for the record_span context manager."""

    def test_noop_when_tracer_is_none(self):
        """Body executes when tracer is None."""
        executed = False
        with record_span(None, "test"):
            executed = True
        assert executed

    def test_body_executes_with_tracer(self):
        """Body executes when tracer is provided."""
        tracer = setup_tracing("test")  # no-op tracer
        executed = False
        with record_span(tracer, "test.operation", {"key": "value"}):
            executed = True
        assert executed

    def test_exception_propagates(self):
        """Exceptions from the body are re-raised."""
        tracer = setup_tracing("test")
        with (
            pytest.raises(ValueError, match="test error"),
            record_span(tracer, "test.operation"),
        ):
            raise ValueError("test error")

    def test_accepts_parent_context(self):
        """Accepts parent_context without error."""
        tracer = setup_tracing("test")
        attrs = {
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        }
        parent_ctx = extract_context_from_attributes(attrs)
        with record_span(tracer, "child.span", parent_context=parent_ctx):
            pass  # Should not raise


class TestShutdownTracing:
    """Tests for shutdown_tracing."""

    def test_shutdown_without_setup_is_noop(self):
        """Calling shutdown without setup does nothing."""
        shutdown_tracing()  # Should not raise
