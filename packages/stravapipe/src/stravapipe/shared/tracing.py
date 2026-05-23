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
        # When one of the standard OTLP endpoint env vars is set, export to
        # OTLP instead of Cloud Trace — for local debugging, point it at a
        # local Collector or Jaeger to capture spans off-process. Production
        # deploys leave these unset and fall through to the GCP exporter
        # below. Mirrors the Go-side switch in
        # packages/shared/otel/provider.go (newTraceExporter).
        otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or os.environ.get(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"
        )

        if otlp_endpoint:
            # Deferred import: keeps the dep optional at the no-op path.
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (  # noqa: PLC0415
                OTLPSpanExporter,
            )

            # Test harness has no need for GCP-derived resource attributes;
            # a minimal resource with just service.name keeps the captured
            # span shape simple and the assertions readable.
            resource = Resource.create({"service.name": service_name})
            exporter = OTLPSpanExporter()  # reads OTEL_EXPORTER_OTLP_* env
        else:
            # Deferred imports: GCP exporters are optional runtime deps.
            # Importing them lazily inside the feature-flagged branch keeps
            # `setup_tracing` a no-op when the packages aren't installed
            # (e.g. local dev).
            from opentelemetry.exporter.cloud_trace import (  # noqa: PLC0415
                CloudTraceSpanExporter,
            )
            from opentelemetry.resourcedetector.gcp_resource_detector import (  # noqa: PLC0415
                GoogleCloudResourceDetector,
            )

            # Detector first, explicit service.name second: OTel's
            # Resource.merge() lets the `other` resource override on
            # conflict, so the explicit attribute must be on the right-hand
            # side to win. Mirrors the Go pattern in
            # packages/shared/otel/provider.go (WithDetectors before
            # WithAttributes). Without this order, `service.name` from the
            # GCP detector or env vars (OTEL_SERVICE_NAME / K_SERVICE)
            # silently clobbers ours, and Cloud Trace's "Service" column
            # shows blank for spans emitted by these Python services.
            gcp_resource = GoogleCloudResourceDetector().detect()
            resource = gcp_resource.merge(
                Resource.create({"service.name": service_name})
            )
            exporter = CloudTraceSpanExporter()  # type: ignore[no-untyped-call, unused-ignore, assignment]

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


def db_attributes(
    system: str,
    name: str,
    operation: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the OTel ``db.*`` semconv attributes for a database span.

    The standard keys (``db.system`` / ``db.name`` / ``db.operation``)
    coexist with the app-specific ``desirelines.*`` attributes, which
    callers pass via ``extra``. Defined once here so the semconv key
    strings live in a single place. See
    packages/apigateway/adapters/postgres/activities.go for the Go-side
    reference pattern.
    """
    attrs: dict[str, Any] = {
        "db.system": system,
        "db.name": name,
        "db.operation": operation,
    }
    if extra:
        attrs.update(extra)
    return attrs


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

        with record_span(tracer, "postgres.insert", {"desirelines.activity_id": 123}):
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
