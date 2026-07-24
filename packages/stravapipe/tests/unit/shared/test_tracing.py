"""Unit tests for the shared tracing module."""

import logging
from unittest.mock import MagicMock, patch

# Force-load the OTel exporter submodules at import time so
# `unittest.mock.patch("...module.ClassName")` can resolve their dotted
# paths in TestSetupTracingExporterSelection. `opentelemetry.exporter`
# is a namespace package; its submodules don't appear as attributes
# until explicitly imported, and production tracing.py only imports
# them lazily inside `setup_tracing()`. Without these top-level
# imports, `patch()` fails at `with` setup with
# `AttributeError: module 'opentelemetry.exporter' has no attribute
# 'cloud_trace'` (and the OTLP equivalent). Side-effect imports —
# the names aren't referenced directly.
import opentelemetry.exporter.cloud_trace
import opentelemetry.exporter.otlp.proto.grpc.trace_exporter

# Asymmetric noqa: ruff flags F401 on this third import but not the
# first two (its dotted-name analysis treats the third `opentelemetry`
# binding as redundant given the first two already bind that name).
# All three are equally needed as side-effect submodule loads for the
# patch() targets below.
import opentelemetry.resourcedetector.gcp_resource_detector  # noqa: F401
from opentelemetry.trace import Tracer
import pytest

from stravapipe.shared.tracing import (
    extract_context_from_attributes,
    record_span,
    setup_tracing,
    shutdown_otel,
    shutdown_tracing,
)


class TestShutdownOtel:
    """shutdown_otel must guard each provider shutdown independently."""

    def test_metrics_failure_does_not_skip_tracing_or_raise(self):
        """A raising metrics shutdown must not prevent the tracing flush."""
        with (
            patch(
                "stravapipe.shared.tracing.shutdown_metrics",
                side_effect=RuntimeError("metrics export failed"),
            ) as mock_metrics,
            patch("stravapipe.shared.tracing.shutdown_tracing") as mock_tracing,
        ):
            shutdown_otel()  # must not raise

        assert mock_metrics.called
        assert mock_tracing.called, "tracing shutdown must run even if metrics fails"

    def test_tracing_failure_is_swallowed(self):
        """A raising tracing shutdown must not propagate out of teardown."""
        with (
            patch("stravapipe.shared.tracing.shutdown_metrics") as mock_metrics,
            patch(
                "stravapipe.shared.tracing.shutdown_tracing",
                side_effect=RuntimeError("span flush failed"),
            ),
        ):
            shutdown_otel()  # must not raise

        assert mock_metrics.called


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


class TestSetupTracingExporterSelection:
    """Tests for the env-gated exporter switch in setup_tracing.

    When `OTEL_EXPORTER_OTLP_ENDPOINT` (or the trace-specific variant) is
    set, setup_tracing must use the OTLP exporter — the switch local
    debugging uses to redirect spans to a Collector / Jaeger. When
    neither is set, it must fall through to the GCP Cloud Trace exporter
    (production behaviour). Mocks are used on both exporter classes so
    the test doesn't depend on real OTLP / GCP connectivity.

    These tests teardown via `shutdown_tracing` to clear the module-level
    singleton; OTel's global `set_tracer_provider` is once-only by design
    and will warn (but not raise) on subsequent calls — that's why we
    assert via the mock's `.called` rather than provider identity.
    """

    def teardown_method(self):
        shutdown_tracing()

    def test_uses_otlp_when_endpoint_env_set(self, monkeypatch):
        monkeypatch.setenv("ENABLE_OTEL_TRACING", "true")
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
        with (
            patch(
                "opentelemetry.exporter.otlp.proto.grpc.trace_exporter.OTLPSpanExporter"
            ) as mock_otlp,
            patch(
                "opentelemetry.exporter.cloud_trace.CloudTraceSpanExporter"
            ) as mock_cloud,
        ):
            tracer = setup_tracing("test-svc")
        assert tracer is not None
        assert mock_otlp.called, "OTLP exporter should have been instantiated"
        assert not mock_cloud.called, (
            "Cloud Trace exporter should NOT be used when OTLP env is set"
        )

    def test_uses_otlp_when_traces_endpoint_env_set(self, monkeypatch):
        # Trace-specific variant per OTel spec.
        monkeypatch.setenv("ENABLE_OTEL_TRACING", "true")
        monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
        monkeypatch.setenv(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://localhost:4317"
        )
        with patch(
            "opentelemetry.exporter.otlp.proto.grpc.trace_exporter.OTLPSpanExporter"
        ) as mock_otlp:
            tracer = setup_tracing("test-svc")
        assert tracer is not None
        assert mock_otlp.called

    def test_uses_cloud_trace_when_no_otlp_env(self, monkeypatch):
        monkeypatch.setenv("ENABLE_OTEL_TRACING", "true")
        monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
        monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", raising=False)
        with (
            patch(
                "opentelemetry.exporter.cloud_trace.CloudTraceSpanExporter"
            ) as mock_cloud,
            # GCP resource detector hits the metadata server otherwise.
            patch(
                "opentelemetry.resourcedetector.gcp_resource_detector.GoogleCloudResourceDetector"
            ),
            patch(
                "opentelemetry.exporter.otlp.proto.grpc.trace_exporter.OTLPSpanExporter"
            ) as mock_otlp,
        ):
            tracer = setup_tracing("test-svc")
        assert tracer is not None
        assert mock_cloud.called, (
            "Cloud Trace exporter should be the default when no OTLP env is set"
        )
        assert not mock_otlp.called, (
            "OTLP exporter should NOT be used when no OTLP env is set"
        )


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

    @staticmethod
    def _tracer_with_span() -> tuple[MagicMock, MagicMock, MagicMock]:
        tracer = MagicMock(spec=Tracer)
        span = MagicMock()
        span_context = MagicMock()
        span_context.__enter__.return_value = span
        tracer.start_as_current_span.return_value = span_context
        return tracer, span, span_context

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

    def test_setup_failure_is_fail_open(self):
        """Broken span creation cannot skip the traced body."""
        tracer, _, span_context = self._tracer_with_span()
        span_context.__enter__.side_effect = RuntimeError("span setup failed")
        executions = 0

        with record_span(tracer, "test.operation"):
            executions += 1

        assert executions == 1

    def test_attribute_failure_is_fail_open_and_span_still_closes(
        self,
        caplog: pytest.LogCaptureFixture,
    ):
        """A rejected attribute cannot alter the body or leak the entered span."""
        tracer, span, span_context = self._tracer_with_span()
        span.set_attribute.side_effect = RuntimeError("attribute rejected")
        executions = 0

        with (
            caplog.at_level(logging.WARNING),
            record_span(tracer, "test.operation", {"bad": object()}),
        ):
            executions += 1

        assert executions == 1
        span_context.__exit__.assert_called_once_with(None, None, None)
        assert "Tracing attribute recording failed" in caplog.text

    def test_body_exception_wins_over_all_error_instrumentation_failures(self):
        """Status, exception, and teardown failures cannot replace body failure."""
        tracer, span, span_context = self._tracer_with_span()
        span.set_status.side_effect = RuntimeError("status failed")
        span.record_exception.side_effect = RuntimeError("record failed")
        span_context.__exit__.side_effect = RuntimeError("teardown failed")
        operation_error = ValueError("body failed")

        with (
            pytest.raises(ValueError, match="body failed") as caught,
            record_span(tracer, "test.operation"),
        ):
            raise operation_error

        assert caught.value is operation_error

    def test_span_cannot_suppress_body_exception(self):
        """A truthy inner __exit__ cannot suppress the operation exception."""
        tracer, _, span_context = self._tracer_with_span()
        span_context.__exit__.return_value = True
        operation_error = ValueError("body failed")

        with (
            pytest.raises(ValueError, match="body failed") as caught,
            record_span(tracer, "test.operation"),
        ):
            raise operation_error

        assert caught.value is operation_error


class TestShutdownTracing:
    """Tests for shutdown_tracing."""

    def test_shutdown_without_setup_is_noop(self):
        """Calling shutdown without setup does nothing."""
        shutdown_tracing()  # Should not raise
