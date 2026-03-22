"""OpenTelemetry metrics setup for Cloud Run Python services.

Provides setup_metrics() for initializing a MeterProvider with GCP Cloud
Monitoring exporter, and record_duration() context manager for timing
adapter calls.

Graceful degradation: if OTel setup fails, the meter returns no-op
instruments and services continue without metrics.
"""

from collections.abc import Generator
from contextlib import contextmanager
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
from opentelemetry.sdk.resources import Resource

logger = logging.getLogger(__name__)

# Export interval matching Cloud Monitoring's minimum resolution
_EXPORT_INTERVAL_MS = 60_000

# Module-level reference for shutdown.
_meter_provider: MeterProvider | None = None


def setup_metrics(service_name: str) -> Meter:
    """Initialize OTel metrics with GCP Cloud Monitoring exporter.

    Returns a Meter for creating instruments. If ENABLE_OTEL_METRICS is not
    set to "true", or if initialization fails, returns a no-op meter.
    """
    global _meter_provider

    if os.environ.get("ENABLE_OTEL_METRICS", "").lower() != "true":
        logger.info("OTel metrics disabled (ENABLE_OTEL_METRICS != true)")
        return get_meter("desirelines.io")

    try:
        from opentelemetry.exporter.cloud_monitoring import (  # type: ignore[import-not-found]
            CloudMonitoringMetricsExporter,
        )
        from opentelemetry.resourcedetector.gcp_resource_detector import (  # type: ignore[import-not-found]
            GoogleCloudResourceDetector,
        )

        gcp_resource = GoogleCloudResourceDetector().detect()
        resource = Resource.create({"service.name": service_name}).merge(gcp_resource)

        exporter = CloudMonitoringMetricsExporter()
        reader = PeriodicExportingMetricReader(
            exporter, export_interval_millis=_EXPORT_INTERVAL_MS
        )

        provider = MeterProvider(resource=resource, metric_readers=[reader])
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
    global _meter_provider
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

    On exception, adds result=error; on success, result=success.
    """
    if histogram is None:
        yield
        return
    attrs = dict(attributes) if attributes else {}
    start = time.monotonic()
    try:
        yield
        attrs["result"] = "success"
    except Exception:
        attrs["result"] = "error"
        raise
    finally:
        elapsed_ms = (time.monotonic() - start) * 1000
        histogram.record(elapsed_ms, attrs)
