"""OpenTelemetry metrics setup for Cloud Run Python services.

Provides setup_metrics() for initializing a MeterProvider with GCP Cloud
Monitoring exporter, and record_duration() context manager for timing
adapter calls.

Graceful degradation: if OTel setup fails, the meter returns no-op
instruments and services continue without metrics.
"""

from collections.abc import Generator
from contextlib import contextmanager
from functools import partial
import logging
import os
import time

from opentelemetry.metrics import (
    Histogram,
    Meter,
    get_meter,
    set_meter_provider,
)
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.metrics.view import (
    DropAggregation,
    ExplicitBucketHistogramAggregation,
    View,
)
from opentelemetry.sdk.resources import Resource

from stravapipe.shared.logging import log_best_effort

logger = logging.getLogger(__name__)

# Export interval matching Cloud Monitoring's minimum resolution
_EXPORT_INTERVAL_MS = 60_000

# Extended histogram buckets for `*.duration` metrics. The OTel default tops out
# at 10s, which clipped webhook/end_to_end.duration (CREATE freshness runs past
# 10s — Strava fetch + cold Cloud Run/Neon) and blocked SLO 3 calibration. The
# wildcard view below applies these to every `.duration` histogram so a new one
# can't silently clip. Mirrors the Go side's extendedDurationBuckets in
# packages/shared/otel/provider.go.
_EXTENDED_DURATION_BUCKETS = [
    1,
    5,
    10,
    25,
    50,
    75,
    100,
    250,
    500,
    750,
    1000,
    2500,
    5000,
    7500,
    10000,
    15000,
    30000,
    60000,
]

# Module-level reference for shutdown.
_meter_provider: MeterProvider | None = None


def _report_duration_metric_failure(phase: str, error: Exception) -> None:
    """Report broken duration instrumentation without risking the operation."""
    log_best_effort(
        partial(
            logger.warning,
            "Duration metric %s failed (%s); operation outcome preserved",
            phase,
            type(error).__name__,
            exc_info=(type(error), error, error.__traceback__),
        )
    )


def _metric_views() -> list[View]:
    """MeterProvider views. Extracted from setup_metrics for testability."""
    return [
        # Drop OTel SDK self-monitoring metrics (otel.sdk.processor.span.*).
        # They're emitted by BatchSpanProcessor in opentelemetry-sdk >= 1.41,
        # and Cloud Monitoring's create_metric_descriptor times out on them
        # without adding actionable observability for our use case.
        View(meter_name="opentelemetry-sdk", aggregation=DropAggregation()),
        # Drop the SQLAlchemy connection-pool metrics (db.client.connections.*).
        # SQLAlchemyInstrumentor (shared/tracing.py) auto-emits these against
        # our generic_task resource, but Cloud Monitoring rejects the export
        # every interval with INVALID_ARGUMENT ("One or more TimeSeries could
        # not be written: timeSeries[0,1] ... written more frequently than the
        # maximum sampling period") — the idle/used series collide on identical
        # resource+label identity. The rejected write produces a noisy gRPC
        # traceback per export and yields zero usable pool observability (the
        # points never land). Wildcard so sibling pool metrics can't silently
        # re-introduce the same noise. Same rationale as the opentelemetry-sdk
        # drop above: a low-value auto-metric Cloud Monitoring chokes on.
        View(instrument_name="db.client.connections.*", aggregation=DropAggregation()),
        # Resolve every `*.duration` histogram past the 10s default ceiling
        # (see _EXTENDED_DURATION_BUCKETS).
        View(
            instrument_name="*.duration",
            aggregation=ExplicitBucketHistogramAggregation(
                boundaries=_EXTENDED_DURATION_BUCKETS
            ),
        ),
    ]


def _otel_enabled(flag: str) -> bool:
    """True when an ``ENABLE_OTEL_*`` env flag is set to "true" (case-insensitive)."""
    return os.environ.get(flag, "").lower() == "true"


def _merge_service_name(base: Resource, service_name: str) -> Resource:
    """Merge an explicit ``service.name`` onto ``base`` so it wins on conflict.

    OTel's ``Resource.merge()`` lets the ``other`` (right-hand) resource win, so
    the explicit attribute must be the argument — otherwise a ``service.name``
    from the GCP detector or env vars (``OTEL_SERVICE_NAME`` / ``K_SERVICE``)
    clobbers ours, blanking per-service attribution in Cloud Monitoring / Cloud
    Trace.
    """
    return base.merge(Resource.create({"service.name": service_name}))


def build_gcp_resource(service_name: str) -> Resource:
    """Build the OTel ``Resource`` for a GCP Cloud Run service.

    Detects GCP environment attributes and merges an explicit ``service.name``
    that wins on conflict (see ``_merge_service_name``). Shared by
    ``setup_metrics`` here and ``setup_tracing`` in tracing.py so the resource
    is identical across providers — they drifted once
    (audit 2026-06-04-stravapipe M1).

    The GCP detector import is deferred to keep the dependency optional; an
    ImportError propagates to the caller's setup ``try/except`` → no-op provider.
    """
    from opentelemetry.resourcedetector.gcp_resource_detector import (  # noqa: PLC0415
        GoogleCloudResourceDetector,
    )

    return _merge_service_name(GoogleCloudResourceDetector().detect(), service_name)


def setup_metrics(service_name: str) -> Meter:
    """Initialize OTel metrics with GCP Cloud Monitoring exporter.

    Returns a Meter for creating instruments. If ENABLE_OTEL_METRICS is not
    set to "true", or if initialization fails, returns a no-op meter.
    """
    global _meter_provider  # noqa: PLW0603 — module-level singleton referenced by shutdown_metrics

    if not _otel_enabled("ENABLE_OTEL_METRICS"):
        logger.info("OTel metrics disabled (ENABLE_OTEL_METRICS != true)")
        return get_meter("desirelines.io")

    try:
        # Deferred import: the GCP exporter is an optional runtime dep. Importing
        # it lazily inside the feature-flagged branch keeps `setup_metrics` a
        # no-op when the package isn't installed (e.g. local dev). The detector
        # import is likewise deferred inside build_gcp_resource.
        from opentelemetry.exporter.cloud_monitoring import (  # noqa: PLC0415
            CloudMonitoringMetricsExporter,
        )

        resource = build_gcp_resource(service_name)

        exporter = CloudMonitoringMetricsExporter()
        reader = PeriodicExportingMetricReader(
            exporter, export_interval_millis=_EXPORT_INTERVAL_MS
        )

        provider = MeterProvider(
            resource=resource,
            metric_readers=[reader],
            views=_metric_views(),
        )
        set_meter_provider(provider)
        _meter_provider = provider

        logger.info(
            "OTel metrics initialized",
            extra={
                "service": service_name,
                "export_interval_ms": _EXPORT_INTERVAL_MS,
            },
        )
        return provider.get_meter("desirelines.io")

    except Exception:
        logger.warning(
            "OTel metrics setup failed, continuing with no-op meter",
            exc_info=True,
        )
        return get_meter("desirelines.io")


def shutdown_metrics() -> None:
    """Flush pending metrics and shut down the meter provider."""
    global _meter_provider  # noqa: PLW0603 — clearing the singleton set in setup_metrics
    if _meter_provider is not None:
        _meter_provider.shutdown()
        _meter_provider = None


@contextmanager
def record_duration(
    histogram: Histogram | None,
    attributes: dict[str, str] | None = None,
) -> Generator[None]:
    """Context manager that records elapsed time (ms) on a histogram.

    If histogram is None, acts as a no-op (the body still executes).

    Usage::

        with record_duration(bq_hist, {"operation": "insert_rows"}):
            bq_client.insert_rows(...)

    On exception, adds result=error; on success, result=success. Timing and
    histogram recording are fail-open: instrumentation cannot alter the body's
    return or exception.
    """
    if histogram is None:
        yield
        return

    try:
        attrs = dict(attributes) if attributes else {}
        start = time.monotonic()
    except Exception as error:
        _report_duration_metric_failure("setup", error)
        yield
        return

    try:
        yield
    except BaseException:
        attrs["result"] = "error"
        try:
            elapsed_ms = (time.monotonic() - start) * 1000
            histogram.record(elapsed_ms, attrs)
        except Exception as error:
            _report_duration_metric_failure("error recording", error)
        raise

    attrs["result"] = "success"
    try:
        elapsed_ms = (time.monotonic() - start) * 1000
        histogram.record(elapsed_ms, attrs)
    except Exception as error:
        _report_duration_metric_failure("success recording", error)
