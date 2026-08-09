"""Tests for the FastAPI / SQLAlchemy OTel instrumentation helpers.

`instrument_fastapi_app` and `instrument_sqlalchemy_engine` are the
auto-instrumentation entry points wired into each Cloud Run app's
lifespan. Both are gated on `ENABLE_OTEL_TRACING` and must fail closed
to a no-op, mirroring `setup_tracing`'s degradation contract.

The two "it actually works" tests pin the behavior the task exists to
deliver: a FastAPI **server span** that parents the handler's manual
`record_span`, and a **per-statement DB span** from the SQLAlchemy
engine.
"""

from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import SpanKind
from sqlalchemy import create_engine, text

from stravapipe.shared.tracing import (
    instrument_fastapi_app,
    instrument_sqlalchemy_engine,
    record_span,
)


def _in_memory_provider() -> tuple[TracerProvider, InMemorySpanExporter]:
    """A TracerProvider wired to an in-memory exporter for span assertions."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider, exporter


class TestInstrumentFastAPIApp:
    """Gating + fail-closed behavior of instrument_fastapi_app."""

    def test_noop_when_tracing_disabled(self, monkeypatch):
        monkeypatch.delenv("ENABLE_OTEL_TRACING", raising=False)
        app = FastAPI()
        instrument_fastapi_app(app)
        assert not getattr(app, "_is_instrumented_by_opentelemetry", False)

    def test_instruments_when_enabled(self, monkeypatch):
        monkeypatch.setenv("ENABLE_OTEL_TRACING", "true")
        app = FastAPI()
        try:
            instrument_fastapi_app(app)
            assert getattr(app, "_is_instrumented_by_opentelemetry", False)
        finally:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.uninstrument_app(app)

    def test_fails_closed_when_instrumentation_raises(self, monkeypatch):
        """A failure inside FastAPIInstrumentor must not propagate — the
        app should still boot, just without instrumentation."""
        monkeypatch.setenv("ENABLE_OTEL_TRACING", "true")
        app = FastAPI()
        with patch(
            "opentelemetry.instrumentation.fastapi.FastAPIInstrumentor.instrument_app",
            side_effect=RuntimeError("instrumentation boom"),
        ):
            instrument_fastapi_app(app)  # must not raise


def test_server_span_parents_an_unparented_child_span(monkeypatch):
    """An instrumented FastAPI app's server span parents a `record_span`
    opened with no explicit parent context.

    This pins the instrumentation *mechanism* — the server span is
    created and nests inner spans under it. It is deliberately NOT the
    production webhook path: `handle_webhook_cloudevent` re-parents
    `webhook.process` on the dispatcher's message-attribute
    `traceparent`, so in the real services the processing span
    continues the dispatcher's end-to-end trace and the server span
    sits in a separate trace (a documented limitation — see
    observability.md).
    """
    monkeypatch.setenv("ENABLE_OTEL_TRACING", "true")
    provider, exporter = _in_memory_provider()
    tracer = provider.get_tracer("test")

    app = FastAPI()

    @app.get("/")
    def _handler() -> dict[str, bool]:
        with record_span(tracer, "handler.work"):
            pass
        return {"ok": True}

    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    # Explicit provider keeps the test isolated from the process-global
    # one (OTel's set_tracer_provider is once-only); the helper itself
    # uses the global, exercised via the gating tests above.
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    try:
        assert TestClient(app).get("/").status_code == 200
    finally:
        FastAPIInstrumentor.uninstrument_app(app)

    spans = exporter.get_finished_spans()
    server_spans = [s for s in spans if s.kind is SpanKind.SERVER]
    assert len(server_spans) == 1, [s.name for s in spans]
    work = next(s for s in spans if s.name == "handler.work")

    assert work.parent is not None, "handler.work span has no parent"
    assert work.parent.span_id == server_spans[0].context.span_id, (
        "handler.work did not nest under the FastAPI server span"
    )
    assert work.context.trace_id == server_spans[0].context.trace_id


class TestInstrumentSQLAlchemyEngine:
    """Gating, fail-closed, and per-statement span emission."""

    def test_noop_when_tracing_disabled(self, monkeypatch):
        monkeypatch.delenv("ENABLE_OTEL_TRACING", raising=False)
        engine = create_engine("sqlite://")
        with patch(
            "opentelemetry.instrumentation.sqlalchemy.SQLAlchemyInstrumentor"
        ) as mock_instrumentor:
            instrument_sqlalchemy_engine(engine)
        mock_instrumentor.assert_not_called()

    def test_fails_closed_when_instrumentation_raises(self, monkeypatch):
        monkeypatch.setenv("ENABLE_OTEL_TRACING", "true")
        engine = create_engine("sqlite://")
        with patch(
            "opentelemetry.instrumentation.sqlalchemy.SQLAlchemyInstrumentor",
            side_effect=RuntimeError("instrumentation boom"),
        ):
            instrument_sqlalchemy_engine(engine)  # must not raise

    def test_emits_span_per_statement(self, monkeypatch):
        """An instrumented engine emits a span for each executed statement."""
        monkeypatch.setenv("ENABLE_OTEL_TRACING", "true")
        provider, exporter = _in_memory_provider()
        engine = create_engine("sqlite://")

        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

        SQLAlchemyInstrumentor().instrument(engine=engine, tracer_provider=provider)
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        finally:
            # SQLAlchemyInstrumentor is a process singleton — uninstrument
            # so a later test's instrument() call is not skipped as "already
            # instrumented".
            SQLAlchemyInstrumentor().uninstrument()

        span_names = [s.name for s in exporter.get_finished_spans()]
        assert any("SELECT" in name for name in span_names), span_names
