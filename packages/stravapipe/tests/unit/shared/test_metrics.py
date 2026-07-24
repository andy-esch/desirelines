"""Unit tests for the shared metrics module's MeterProvider views."""

import logging
from unittest.mock import MagicMock, patch

from opentelemetry.metrics import Histogram
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    HistogramDataPoint,
    InMemoryMetricReader,
)
from opentelemetry.sdk.resources import Resource
import pytest

from stravapipe.shared.metrics import (
    _EXTENDED_DURATION_BUCKETS,
    _merge_service_name,
    _metric_views,
    record_duration,
)


def _record_and_get_bounds(name: str, value: float) -> list[float] | None:
    """Record one value into a histogram and return its exported bucket bounds."""
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader], views=_metric_views())
    provider.get_meter("desirelines.io").create_histogram(name).record(value)

    data = reader.get_metrics_data()
    if data is None:
        return None
    for rm in data.resource_metrics:
        for sm in rm.scope_metrics:
            for metric in sm.metrics:
                if metric.name != name:
                    continue
                point = metric.data.data_points[0]
                if isinstance(point, HistogramDataPoint):
                    return list(point.explicit_bounds)
    return None


def test_duration_histogram_gets_extended_buckets() -> None:
    # A `*.duration` histogram must resolve past the 10s default ceiling —
    # otherwise a >10s value (e.g. cold-start webhook freshness) clips and the
    # P95 is unmeasurable (the bug that hid SLO 3's data).
    bounds = _record_and_get_bounds("desirelines.io/webhook/end_to_end.duration", 15000)
    assert bounds is not None, "histogram was not exported"
    assert bounds[-1] == 60000
    assert [float(b) for b in bounds] == [float(b) for b in _EXTENDED_DURATION_BUCKETS]


def test_non_duration_histogram_keeps_default_buckets() -> None:
    # The extended-bucket view is scoped to `*.duration`; other histograms keep
    # the OTel default boundaries (which top out at 10s).
    bounds = _record_and_get_bounds("desirelines.io/test/widget.count", 15000)
    assert bounds is not None
    assert bounds[-1] != 60000


def test_connection_pool_metrics_are_dropped() -> None:
    # SQLAlchemyInstrumentor's db.client.connections.* metrics are dropped: Cloud
    # Monitoring rejects them every export (duplicate-series INVALID_ARGUMENT),
    # producing gRPC traceback noise and no usable data. The wildcard view must
    # suppress them so nothing reaches the reader.
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader], views=_metric_views())
    provider.get_meter("desirelines.io").create_up_down_counter(
        "db.client.connections.usage"
    ).add(1, {"state": "idle"})

    data = reader.get_metrics_data()
    exported = [
        metric.name
        for rm in (data.resource_metrics if data else [])
        for sm in rm.scope_metrics
        for metric in sm.metrics
    ]
    assert "db.client.connections.usage" not in exported


def test_merge_service_name_explicit_wins_over_detected() -> None:
    # The explicit service.name must override one the GCP detector already
    # carries (the metrics-side bug: a left-side merge let the detector win and
    # blanked per-service attribution). Mirrors the setup_tracing invariant.
    detected = Resource.create(
        {"service.name": "detected-by-gcp", "cloud.provider": "gcp"}
    )
    merged = _merge_service_name(detected, "desirelines-postgres-writer")

    assert merged.attributes["service.name"] == "desirelines-postgres-writer"
    # Non-conflicting detector attributes survive the merge.
    assert merged.attributes["cloud.provider"] == "gcp"


def test_record_duration_records_success_without_mutating_input() -> None:
    histogram = MagicMock(spec=Histogram)
    attributes = {"operation": "insert"}

    with (
        patch(
            "stravapipe.shared.metrics.time.monotonic",
            side_effect=[10.0, 10.25],
        ),
        record_duration(histogram, attributes),
    ):
        pass

    histogram.record.assert_called_once_with(
        250.0,
        {"operation": "insert", "result": "success"},
    )
    assert attributes == {"operation": "insert"}


def test_record_duration_records_error_and_preserves_body_exception() -> None:
    histogram = MagicMock(spec=Histogram)
    operation_error = ValueError("write failed")

    with (
        patch(
            "stravapipe.shared.metrics.time.monotonic",
            side_effect=[10.0, 10.5],
        ),
        pytest.raises(ValueError, match="write failed") as caught,
        record_duration(histogram, {"operation": "insert"}),
    ):
        raise operation_error

    assert caught.value is operation_error
    histogram.record.assert_called_once_with(
        500.0,
        {"operation": "insert", "result": "error"},
    )


def test_record_duration_success_is_preserved_when_histogram_fails(
    caplog: pytest.LogCaptureFixture,
) -> None:
    histogram = MagicMock(spec=Histogram)
    histogram.record.side_effect = RuntimeError("metrics unavailable")
    executions = 0

    with caplog.at_level(logging.WARNING), record_duration(histogram):
        executions += 1

    assert executions == 1
    assert "operation outcome preserved" in caplog.text


def test_record_duration_body_exception_wins_when_histogram_also_fails() -> None:
    histogram = MagicMock(spec=Histogram)
    histogram.record.side_effect = RuntimeError("metrics unavailable")
    operation_error = ValueError("write failed")

    with (
        pytest.raises(ValueError, match="write failed") as caught,
        record_duration(histogram),
    ):
        raise operation_error

    assert caught.value is operation_error


def test_record_duration_body_exception_wins_when_teardown_clock_fails() -> None:
    histogram = MagicMock(spec=Histogram)
    operation_error = ValueError("write failed")

    with (
        patch(
            "stravapipe.shared.metrics.time.monotonic",
            side_effect=[10.0, RuntimeError("clock unavailable")],
        ),
        pytest.raises(ValueError, match="write failed") as caught,
        record_duration(histogram),
    ):
        raise operation_error

    assert caught.value is operation_error
    histogram.record.assert_not_called()


def test_record_duration_logging_failure_does_not_resurface_metric_failure() -> None:
    histogram = MagicMock(spec=Histogram)
    histogram.record.side_effect = RuntimeError("metrics unavailable")

    with (
        patch(
            "stravapipe.shared.metrics.logger.warning",
            side_effect=RuntimeError("logging unavailable"),
        ),
        record_duration(histogram),
    ):
        pass


def test_record_duration_setup_failure_is_fail_open() -> None:
    histogram = MagicMock(spec=Histogram)
    executions = 0

    with (
        patch(
            "stravapipe.shared.metrics.time.monotonic",
            side_effect=RuntimeError("clock unavailable"),
        ),
        record_duration(histogram),
    ):
        executions += 1

    assert executions == 1
    histogram.record.assert_not_called()
