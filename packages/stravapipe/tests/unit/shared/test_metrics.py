"""Unit tests for the shared metrics module's MeterProvider views."""

from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    HistogramDataPoint,
    InMemoryMetricReader,
)
from opentelemetry.sdk.resources import Resource

from stravapipe.shared.metrics import (
    _EXTENDED_DURATION_BUCKETS,
    _merge_service_name,
    _metric_views,
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
