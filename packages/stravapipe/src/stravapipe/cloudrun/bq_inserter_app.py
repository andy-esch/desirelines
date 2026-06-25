"""FastAPI application for BigQuery inserter Cloud Run service.

This module provides the HTTP interface for receiving Pub/Sub CloudEvents
and syncing Strava activities to BigQuery. It acts as a thin controller,
delegating business logic to the existing application services.

Activity data is now provided inline in the enriched event from the dispatcher
(raw_activity field) rather than fetched from the Strava API by this service.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from opentelemetry.metrics import Histogram
from opentelemetry.trace import Tracer

from stravapipe.adapters.gcp import (
    make_bigquery_client_wrapper,
    make_write_activities,
)
from stravapipe.application.bq_inserter import (
    DeleteActivityService,
    make_delete_service,
)
from stravapipe.cloudrun.errors import validate_or_422
from stravapipe.cloudrun.webhook_handler import handle_webhook_cloudevent
from stravapipe.config import load_bq_inserter_config
from stravapipe.domain.activity import DetailedStravaActivity
from stravapipe.ports.out.write import WriteActivities
from stravapipe.shared.constants import ResponseStatus, SkipReason
from stravapipe.shared.logging import setup_logging
from stravapipe.shared.metrics import record_duration, setup_metrics
from stravapipe.shared.readiness import (
    build_ready_response,
    check_bigquery,
    register_health_route,
    run_checks,
)
from stravapipe.shared.responses import WebhookResponse
from stravapipe.shared.tracing import (
    db_attributes,
    instrument_fastapi_app,
    record_span,
    setup_tracing,
    shutdown_otel,
)
from stravapipe.types.generated import webhook_pb2 as pb

logger = setup_logging(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize shared resources on startup and ensure clean shutdown."""
    # Pre-seed teardown-relevant slots so the `finally` block can run
    # safely even if startup raises before these are populated.
    app.state.writer = None

    try:
        config = load_bq_inserter_config()
        logger.info("BQ Inserter configuration validated successfully")

        # Initialize OTel tracing + metrics first so both can be threaded
        # into adapters built below. The writer takes the histogram so the
        # `merge_from_staging` sub-span records duration on the same
        # `bigquery/operation.duration` metric the outer `bigquery.insert_rows`
        # already uses. (delete_service intentionally does not — the outer
        # `bigquery.dml` histogram is sufficient for alerting on the rare
        # DELETE path; see expose-sub-span-histograms-for-slo-alerting.)
        app.state.tracer = setup_tracing("desirelines-bq-inserter")
        meter = setup_metrics("desirelines-bq-inserter")
        app.state.bq_histogram = meter.create_histogram(
            "desirelines.io/bigquery/operation.duration",
            unit="ms",
            description="BigQuery operation duration",
        )
        app.state.webhook_counter = meter.create_counter(
            "desirelines.io/webhook/events",
            description="Webhook events processed",
        )

        # FastAPI server span + http.server.* metrics — binds the global
        # providers set just above.
        instrument_fastapi_app(app)

        app.state.writer = make_write_activities(
            project_id=config.project_id,
            bq_dataset=config.bq_dataset,
            tracer=app.state.tracer,
            histogram=app.state.bq_histogram,
        )
        logger.info("BigQuery writer initialized")

        app.state.delete_service = make_delete_service(config, tracer=app.state.tracer)
        logger.info("BigQuery delete service initialized")

        # Held for /ready dependency probe (get_dataset on the configured dataset).
        app.state.bq_client = make_bigquery_client_wrapper(project_id=config.project_id)
        app.state.bq_dataset = config.bq_dataset

        app.state.readiness_timeout = config.readiness_timeout

        yield
    except Exception:
        logger.exception("Application lifecycle error")
        raise
    finally:
        # Close the BQ Storage Write stream before tearing down OTel so
        # any final stream-close log/metric still has a tracer available.
        if app.state.writer is not None:
            app.state.writer.close()
        # shutdown_otel guards each provider shutdown independently (and is safe
        # to call when a provider was never initialized) and logs completion.
        shutdown_otel()


app = FastAPI(
    title="BigQuery Inserter",
    description="Syncs Strava activities to BigQuery via Pub/Sub CloudEvents",
    lifespan=lifespan,
)


register_health_route(app)


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness probe — verifies BigQuery is reachable. Hit hourly by Cloud Scheduler."""
    bq_client = request.app.state.bq_client
    dataset_id = request.app.state.bq_dataset
    checks = await run_checks(
        {"bigquery": lambda: check_bigquery(bq_client, dataset_id)},
        timeout=request.app.state.readiness_timeout,
    )
    return build_ready_response(checks)


@app.post("/")
async def handle_pubsub(request: Request) -> WebhookResponse:
    """Handle Pub/Sub CloudEvent from Eventarc."""
    writer = request.app.state.writer
    delete_service = request.app.state.delete_service
    bq_dataset = request.app.state.bq_dataset
    bq_hist = request.app.state.bq_histogram
    webhook_counter = request.app.state.webhook_counter
    tracer = request.app.state.tracer
    return await handle_webhook_cloudevent(
        request,
        logger,
        on_create=lambda event, event_data, cid: _handle_create(
            event, event_data, cid, writer, bq_dataset, bq_hist, tracer
        ),
        on_delete=lambda event, event_data, cid: _handle_delete(
            event, cid, delete_service, bq_dataset, bq_hist, tracer
        ),
        webhook_counter=webhook_counter,
        tracer=tracer,
        # Service-prefixed so this doesn't collide with the postgres-writer's
        # span on the same Pub/Sub event in Cloud Trace's compact view.
        span_name="bq_inserter.webhook.process",
    )


async def _handle_create(
    event: pb.WebhookEvent,
    event_data: dict[str, Any],
    correlation_id: str,
    writer: WriteActivities,
    bq_dataset: str,
    bq_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
) -> WebhookResponse:
    """Handle CREATE events - write activity to BigQuery.

    Activity data is provided inline from the dispatcher's enriched event.
    No Strava API call is needed.
    """
    raw_activity = event_data.get("raw_activity")

    if raw_activity is None:
        logger.warning(
            "CREATE event missing raw_activity, skipping",
            extra={"activity_id": event.object_id},
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            reason=SkipReason.ACTIVITY_NOT_FOUND,
            activity_id=event.object_id,
            correlation_id=correlation_id,
        )

    # Construct DetailedStravaActivity from raw Strava API JSON.
    # ValidationError → 422 so Pub/Sub acks immediately; retrying a
    # malformed payload will fail identically.
    activity = validate_or_422(
        DetailedStravaActivity, raw_activity, context="raw_activity"
    )

    with (
        record_span(
            tracer,
            "bigquery.insert_rows",
            db_attributes(
                "bigquery",
                bq_dataset,
                "MERGE",
                {"desirelines.activity_id": event.object_id},
            ),
        ),
        record_duration(bq_histogram, {"operation": "insert_rows"}),
    ):
        stats = writer.write_activity(activity)

    logger.info(
        "Activity upserted to BigQuery",
        extra={
            "activity_id": event.object_id,
            "rows_affected": stats.get("rows_affected", 0),
            "execution_time_ms": stats.get("execution_time_ms"),
        },
    )

    return WebhookResponse(
        status=ResponseStatus.CREATED,
        activity_id=event.object_id,
        correlation_id=correlation_id,
    )


async def _handle_delete(
    event: pb.WebhookEvent,
    correlation_id: str,
    service: DeleteActivityService,
    bq_dataset: str,
    bq_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
) -> WebhookResponse:
    """Handle DELETE events - archive and remove from BigQuery."""
    with (
        record_span(
            tracer,
            "bigquery.dml",
            db_attributes(
                "bigquery",
                bq_dataset,
                "DELETE",
                {"desirelines.activity_id": event.object_id},
            ),
        ),
        record_duration(bq_histogram, {"operation": "dml"}),
    ):
        result = service.run(
            activity_id=event.object_id,
            correlation_id=correlation_id,
            event_time=event.event_time,
        )

    if result.rows_archived == 0:
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            reason=SkipReason.ACTIVITY_NOT_FOUND,
            activity_id=result.activity_id,
            correlation_id=correlation_id,
        )

    return WebhookResponse(
        status=ResponseStatus.PROCESSED,
        action=ResponseStatus.DELETED,
        activity_id=result.activity_id,
        correlation_id=correlation_id,
    )
