"""OpenTelemetry tracing setup for Cloud Run Python services.

Provides setup_tracing() for initializing a TracerProvider with GCP Cloud
Trace exporter, and record_span() context manager for creating spans in
adapter calls.

Graceful degradation: if OTel setup fails, the tracer returns no-op spans
and services continue without tracing.
"""

from collections.abc import Generator
from contextlib import contextmanager
import logging
import os
from typing import Any

from opentelemetry.context import Context
from opentelemetry.propagate import extract
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import (
    StatusCode,
    Tracer,
    get_tracer,
    set_tracer_provider,
)

logger = logging.getLogger(__name__)

# Module-level reference for shutdown.
_tracer_provider: TracerProvider | None = None


def setup_tracing(service_name: str) -> Tracer:
    """Initialize OTel tracing with GCP Cloud Trace exporter.

    Returns a Tracer for creating spans. If ENABLE_OTEL_TRACING is not
    set to "true", or if initialization fails, returns a no-op tracer.
    """
    global _tracer_provider  # noqa: PLW0603 — module-level singleton referenced by shutdown_tracing

    if os.environ.get("ENABLE_OTEL_TRACING", "").lower() != "true":
        logger.info("OTel tracing disabled (ENABLE_OTEL_TRACING != true)")
        return get_tracer("desirelines.io")

    try:
        # Deferred imports: GCP exporters are optional runtime deps. Importing
        # them lazily inside the feature-flagged branch keeps `setup_tracing`
        # a no-op when the packages aren't installed (e.g. local dev).
        from opentelemetry.exporter.cloud_trace import (  # type: ignore[import-not-found]  # noqa: PLC0415
            CloudTraceSpanExporter,
        )
        from opentelemetry.resourcedetector.gcp_resource_detector import (  # type: ignore[import-not-found]  # noqa: PLC0415
            GoogleCloudResourceDetector,
        )

        gcp_resource = GoogleCloudResourceDetector().detect()
        resource = Resource.create({"service.name": service_name}).merge(gcp_resource)

        exporter = CloudTraceSpanExporter()
        processor = BatchSpanProcessor(exporter)

        provider = TracerProvider(resource=resource)
        provider.add_span_processor(processor)
        set_tracer_provider(provider)
        _tracer_provider = provider

        logger.info("OTel tracing initialized", extra={"service": service_name})
        return provider.get_tracer("desirelines.io")

    except Exception:
        logger.warning(
            "OTel tracing setup failed, continuing with no-op tracer",
            exc_info=True,
        )
        return get_tracer("desirelines.io")


def shutdown_tracing() -> None:
    """Flush pending spans and shut down the tracer provider."""
    global _tracer_provider  # noqa: PLW0603 — clearing the singleton set in setup_tracing
    if _tracer_provider is not None:
        _tracer_provider.shutdown()
        _tracer_provider = None


def extract_context_from_attributes(
    attributes: dict[str, str],
) -> Context | None:
    """Extract W3C trace context from PubSub message attributes.

    Looks for the ``traceparent`` key injected by the Go dispatcher via
    ``otel.GetTextMapPropagator().Inject()``.

    Returns the extracted Context, or None if no traceparent is present.
    """
    if "traceparent" not in attributes:
        return None
    return extract(attributes)


@contextmanager
def record_span(
    tracer: Tracer | None,
    name: str,
    attributes: dict[str, Any] | None = None,
    parent_context: Context | None = None,
) -> Generator[None]:
    """Context manager that creates and manages an OTel span.

    If tracer is None, acts as a no-op (the body still executes).

    Usage::

        with record_span(tracer, "postgres.insert", {"activity_id": 123}):
            uow.activities.insert(activity)

    On exception, records the error on the span; on success, sets OK status.
    """
    if tracer is None:
        yield
        return

    kwargs: dict[str, Any] = {}
    if parent_context is not None:
        kwargs["context"] = parent_context

    with tracer.start_as_current_span(name, **kwargs) as span:
        if attributes:
            for key, value in attributes.items():
                span.set_attribute(key, value)
        try:
            yield
        except Exception as exc:
            span.set_status(StatusCode.ERROR, str(exc))
            span.record_exception(exc)
            raise
