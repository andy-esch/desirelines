"""OpenTelemetry tracing setup for Cloud Run Python services.

Provides setup_tracing() for initializing a TracerProvider with GCP Cloud
Trace exporter, and record_span() context manager for creating spans in
adapter calls.

Graceful degradation: if OTel setup fails, the tracer returns no-op spans
and services continue without tracing.
"""

from collections.abc import Generator
from contextlib import contextmanager
from functools import partial
import logging
import os
from typing import Any

from fastapi import FastAPI
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
from sqlalchemy.engine import Engine

from stravapipe.shared.logging import log_best_effort
from stravapipe.shared.metrics import (
    _otel_enabled,
    build_gcp_resource,
    shutdown_metrics,
)

logger = logging.getLogger(__name__)

# Module-level reference for shutdown.
_tracer_provider: TracerProvider | None = None


def _report_span_failure(
    span_name: str,
    phase: str,
    error: Exception,
) -> None:
    """Report broken instrumentation without risking the traced operation."""
    log_best_effort(
        partial(
            logger.warning,
            "Tracing %s failed for %s (%s); operation outcome preserved",
            phase,
            span_name,
            type(error).__name__,
            exc_info=(type(error), error, error.__traceback__),
        )
    )


def setup_tracing(service_name: str) -> Tracer:
    """Initialize OTel tracing with GCP Cloud Trace exporter.

    Returns a Tracer for creating spans. If ENABLE_OTEL_TRACING is not
    set to "true", or if initialization fails, returns a no-op tracer.
    """
    global _tracer_provider  # noqa: PLW0603 — module-level singleton referenced by shutdown_tracing

    if not _otel_enabled("ENABLE_OTEL_TRACING"):
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

            # Shared resource builder keeps metrics + tracing identical (the
            # detector import lives inside it; mirrors the Go pattern in
            # packages/shared/otel/provider.go).
            resource = build_gcp_resource(service_name)
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


def shutdown_otel() -> None:
    """Shut down both OTel providers, guarding each independently.

    A failed flush in one provider (e.g. a network blip during a Cloud Run
    revision swap) must not skip the other or — since this runs in the lifespan
    ``finally`` — mask an in-flight startup/shutdown error. Each provider
    shutdown is isolated in its own try/except (log-and-continue), so buffered
    spans still flush even if the metrics export throws, and vice versa.
    """
    try:
        shutdown_metrics()
    except Exception:
        logger.exception("OTel metrics shutdown failed")
    try:
        shutdown_tracing()
    except Exception:
        logger.exception("OTel tracing shutdown failed")
    logger.info("OTel resources shutdown")


def instrument_fastapi_app(app: FastAPI) -> None:
    """Enable OpenTelemetry auto-instrumentation for a FastAPI app.

    Wraps every request in an HTTP server span and emits the standard
    ``http.server.*`` metrics against the global MeterProvider that
    ``setup_metrics`` installed.

    Note: the webhook handlers re-parent their processing span on the
    dispatcher's cross-service ``traceparent`` (carried in the Pub/Sub
    message body, which a header-based server span can't see), so that
    span continues the dispatcher's end-to-end trace rather than nesting
    under this server span — the two are separate traces by design. See
    docs/architecture/observability.md.

    Gated on ``ENABLE_OTEL_TRACING`` and fails closed to a no-op,
    matching ``setup_tracing``'s degradation contract. Call from the app
    lifespan after ``setup_tracing`` / ``setup_metrics`` so the global
    providers already exist.
    """
    if not _otel_enabled("ENABLE_OTEL_TRACING"):
        logger.info("FastAPI instrumentation skipped (ENABLE_OTEL_TRACING != true)")
        return

    try:
        # Deferred import: parity with setup_tracing — keeps tracing.py
        # importable even if the optional instrumentation package is absent.
        from opentelemetry.instrumentation.fastapi import (  # noqa: PLC0415
            FastAPIInstrumentor,
        )

        FastAPIInstrumentor.instrument_app(app)
        logger.info("FastAPI OTel instrumentation enabled")
    except Exception:
        logger.warning(
            "FastAPI instrumentation failed, continuing without it",
            exc_info=True,
        )


def instrument_sqlalchemy_engine(engine: Engine) -> None:
    """Enable OpenTelemetry auto-instrumentation for a SQLAlchemy engine.

    Emits a span per executed SQL statement, parented under whatever
    span is active when the statement runs (e.g. the handler's
    ``record_span``). Gated on ``ENABLE_OTEL_TRACING`` and fails closed
    to a no-op.
    """
    if not _otel_enabled("ENABLE_OTEL_TRACING"):
        logger.info("SQLAlchemy instrumentation skipped (ENABLE_OTEL_TRACING != true)")
        return

    try:
        from opentelemetry.instrumentation.sqlalchemy import (  # noqa: PLC0415
            SQLAlchemyInstrumentor,
        )

        # Footgun: SQLAlchemyInstrumentor().instrument(engine=None) silently
        # switches to *global* instrumentation (wraps every future engine
        # created via create_engine, in-process). The `engine: Engine`
        # signature (not Optional) is the defense — don't relax it.
        SQLAlchemyInstrumentor().instrument(engine=engine)
        logger.info("SQLAlchemy OTel instrumentation enabled")
    except Exception:
        logger.warning(
            "SQLAlchemy instrumentation failed, continuing without it",
            exc_info=True,
        )


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

    On exception, records the error and sets the span status to ERROR; on
    success the status is left UNSET (OTel's default — instrumentation should
    not force OK). All instrumentation is fail-open: span creation, attribute
    recording, error recording, and teardown cannot alter the body's return or
    exception.
    """
    if tracer is None:
        yield
        return

    kwargs: dict[str, Any] = {}
    if parent_context is not None:
        kwargs["context"] = parent_context

    try:
        span_context = tracer.start_as_current_span(name, **kwargs)
        span = span_context.__enter__()
    except Exception as error:
        _report_span_failure(name, "setup", error)
        yield
        return

    if attributes:
        try:
            for key, value in attributes.items():
                span.set_attribute(key, value)
        except Exception as error:
            _report_span_failure(name, "attribute recording", error)

    try:
        yield
    except BaseException as operation_error:
        try:
            span.set_status(StatusCode.ERROR, str(operation_error))
        except Exception as error:
            _report_span_failure(name, "error status recording", error)
        try:
            span.record_exception(operation_error)
        except Exception as error:
            _report_span_failure(name, "exception recording", error)
        try:
            span_context.__exit__(
                type(operation_error),
                operation_error,
                operation_error.__traceback__,
            )
        except Exception as error:
            _report_span_failure(name, "error teardown", error)
        raise

    try:
        span_context.__exit__(None, None, None)
    except Exception as error:
        _report_span_failure(name, "teardown", error)
