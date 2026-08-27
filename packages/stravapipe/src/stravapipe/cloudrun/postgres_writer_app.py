"""FastAPI application for PostgreSQL writer Cloud Run service.

This module provides the HTTP interface for receiving Pub/Sub CloudEvents
and syncing Strava activities to PostgreSQL. It acts as a thin controller,
delegating business logic to the existing application services.

Activity data is now provided inline in the enriched event from the dispatcher
(raw_activity field) rather than fetched from the Strava API by this service.
"""

from collections.abc import AsyncIterator
from contextlib import AbstractContextManager, asynccontextmanager
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from opentelemetry.metrics import Counter, Histogram
from opentelemetry.trace import Tracer
from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.postgres import SqlAlchemyUnitOfWork
from stravapipe.adapters.postgres._unit_of_work import create_session_factory
from stravapipe.cloudrun.errors import validate_or_422
from stravapipe.cloudrun.webhook_handler import handle_webhook_cloudevent
from stravapipe.config import load_postgres_writer_config
from stravapipe.domain.activity import (
    StandardActivity,
    is_non_geographic_activity,
)
from stravapipe.domain.geometry import decode_polyline_to_geojson
from stravapipe.ports.out.postgres import (
    DeleteResult,
    InsertResult,
    MetadataUpdateResult,
)
from stravapipe.shared.constants import ResponseStatus, SkipReason
from stravapipe.shared.correlation import get_dispatcher_received_at_ms
from stravapipe.shared.logging import setup_logging
from stravapipe.shared.metrics import record_duration, setup_metrics
from stravapipe.shared.readiness import (
    build_ready_response,
    check_postgres,
    register_health_route,
    run_checks,
)
from stravapipe.shared.responses import WebhookResponse
from stravapipe.shared.tracing import (
    db_attributes,
    instrument_fastapi_app,
    instrument_sqlalchemy_engine,
    record_span,
    setup_tracing,
    shutdown_otel,
)
from stravapipe.types.generated import webhook_pb2 as pb

logger = setup_logging(__name__)


def _pg_span(
    tracer: Tracer | None,
    name: str,
    verb: str,
    activity_id: int,
) -> AbstractContextManager[None]:
    """Open a postgres span with this module's shared ``db.*`` attributes.

    Every postgres call site here tags its span with the same invariants —
    ``db.system=postgresql``, ``db.name=desirelines``, and the activity_id —
    varying only the span name and SQL verb. Centralizing the ``db_attributes``
    call keeps those three constants in one place (mirrors ``_try_delete_step``
    in ``deletion_service_app.py``).
    """
    return record_span(
        tracer,
        name,
        db_attributes(
            "postgresql",
            "desirelines",
            verb,
            {"desirelines.activity_id": activity_id},
        ),
    )


def _record_freshness(
    freshness_histogram: Histogram | None,
    aspect_type: str,
) -> None:
    """Record end-to-end webhook freshness for SLO 3, if the inputs allow.

    No-op when the histogram isn't available (e.g. a test path without
    lifespan init). When the dispatcher didn't stamp the Pub/Sub
    `dispatcher_received_at_unix_ms` attribute, we also skip — but log it
    (with `aspect_type`) so a systematic gap is visible rather than silently
    shrinking the SLO 3 sample.

    Called by each of `_handle_create`, `_handle_update`,
    `_handle_delete` on their success path. Skipped/DLQ events are
    governed by SLO 2 (webhook ingest success), not this metric.
    """
    if freshness_histogram is None:
        return
    received_at_ms = get_dispatcher_received_at_ms()
    if received_at_ms is None:
        # Missing-input skip. Log (don't stay silent) so the skip rate is
        # observable in Cloud Logging — a systematic gap (dispatcher regression
        # or a message class that never carries the stamp) would otherwise
        # shrink the SLO 3 sample with zero signal.
        logger.warning(
            "Freshness not recorded: dispatcher_received_at_unix_ms absent",
            extra={"aspect_type": aspect_type},
        )
        return
    # Clamp clock-skew negatives: received_at is stamped on the dispatcher,
    # time.time() on the writer — different wall clocks. Skew can make elapsed
    # negative, which OTel's record() rejects and drops silently. Clamping to 0
    # keeps fast UPDATE/DELETE samples (the realistic skew trigger) in the SLO.
    elapsed_ms = max(0.0, (time.time() * 1000.0) - received_at_ms)
    freshness_histogram.record(elapsed_ms, {"aspect_type": aspect_type})


def _record_stale_drop(
    stale_event_counter: Counter | None,
    aspect_type: str,
) -> None:
    """Count a live write dropped by the event_time fence, if the counter exists.

    No-op when the counter isn't available (a test path without lifespan init).
    """
    if stale_event_counter is None:
        return
    stale_event_counter.add(1, {"aspect_type": aspect_type})


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize shared resources on startup and ensure clean shutdown."""
    try:
        config = load_postgres_writer_config()
        logger.info("PostgreSQL Writer configuration validated successfully")

        # Create session factory once at startup (connection pool)
        app.state.db_engine, app.state.session_factory = create_session_factory(
            config.postgres_connection_string
        )
        logger.info("PostgreSQL session factory initialized")

        app.state.readiness_timeout = config.readiness_timeout

        # Initialize OTel metrics
        meter = setup_metrics("desirelines-postgres-writer")
        app.state.pg_histogram = meter.create_histogram(
            "desirelines.io/postgres/operation.duration",
            unit="ms",
            description="PostgreSQL operation duration",
        )
        app.state.webhook_counter = meter.create_counter(
            "desirelines.io/webhook/events",
            description="Webhook events processed",
        )
        # Out-of-order fence: incremented whenever a live UPDATE is dropped
        # because its event_time is older than the row's stored last_event_time
        # (see V0007). Makes reordering visible in Cloud Monitoring instead of
        # silently discarded. Labeled by aspect_type.
        app.state.stale_event_counter = meter.create_counter(
            "desirelines.io/stravapipe/write/stale_event_dropped",
            description=(
                "Live activity writes dropped by the event_time fence because a "
                "newer event already landed (out-of-order/reordered delivery)."
            ),
        )
        # Resurrection guard: incremented when a CREATE is rejected because a
        # deletion tombstone with a newer-or-equal event_time exists (a late /
        # reordered CREATE that would otherwise resurrect a deleted activity).
        app.state.resurrection_counter = meter.create_counter(
            "desirelines.io/stravapipe/write/resurrection_blocked",
            description=(
                "CREATE events rejected because a deletion tombstone would be "
                "resurrected (late/reordered CREATE after a DELETE)."
            ),
        )
        # End-to-end webhook freshness: time from dispatcher receiving the
        # Strava webhook to the activity row landing in postgres. Anchors
        # SLO 3 (data freshness). The dispatcher stamps a
        # `dispatcher_received_at_unix_ms` Pub/Sub attribute on every
        # message; we read it here and record `now() - received_at` after
        # a successful insert. Lost events (DLQ) don't emit a measurement,
        # so they count against the SLO via its denominator.
        app.state.freshness_histogram = meter.create_histogram(
            "desirelines.io/webhook/end_to_end.duration",
            unit="ms",
            description=(
                "End-to-end webhook latency from dispatcher receive to "
                "the postgres state reflecting the change. Records on "
                "success paths only: new row inserted (CREATE), metadata "
                "updated (UPDATE), row deleted (DELETE). Skips and DLQ "
                "events don't emit; the latter are covered by SLO 2 "
                "(webhook ingest success)."
            ),
        )

        # Initialize OTel tracing
        app.state.tracer = setup_tracing("desirelines-postgres-writer")

        # FastAPI server span + http.server.* metrics; SQLAlchemy
        # statement spans on the pooled engine. After both OTel providers
        # and the engine exist.
        instrument_fastapi_app(app)
        instrument_sqlalchemy_engine(app.state.db_engine)

        yield
    except Exception:
        logger.exception("Application lifecycle error")
        raise
    finally:
        # Dispose the SQLAlchemy engine so connections are closed cleanly when a
        # Cloud Run revision is replaced — otherwise pooled connections leak until
        # the container is torn down.
        engine = getattr(app.state, "db_engine", None)
        if engine is not None:
            engine.dispose()
            logger.info("PostgreSQL engine disposed")

        # shutdown_otel guards each provider shutdown independently (and is safe
        # to call when a provider was never initialized) and logs completion.
        shutdown_otel()


app = FastAPI(
    title="PostgreSQL Writer",
    description="Syncs Strava activities to PostgreSQL via Pub/Sub CloudEvents",
    lifespan=lifespan,
)


register_health_route(app)


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness probe — verifies Postgres is reachable. Hit hourly by Cloud Scheduler.

    Avoid wiring this to high-frequency Cloud Run probes: Neon bills compute
    by the hour, so each ping wakes the database.
    """
    session_factory = request.app.state.session_factory
    checks = await run_checks(
        {"postgres": lambda: check_postgres(session_factory)},
        timeout=request.app.state.readiness_timeout,
    )
    return build_ready_response(checks)


@app.post("/")
async def handle_pubsub(request: Request) -> WebhookResponse:
    """Handle Pub/Sub CloudEvent from Eventarc."""
    session_factory = request.app.state.session_factory
    pg_hist = request.app.state.pg_histogram
    freshness_hist = request.app.state.freshness_histogram
    webhook_counter = request.app.state.webhook_counter
    stale_counter = request.app.state.stale_event_counter
    resurrection_counter = request.app.state.resurrection_counter
    tracer = request.app.state.tracer
    return await handle_webhook_cloudevent(
        request,
        logger,
        on_create=lambda event, event_data, cid: _handle_create(
            event,
            event_data,
            cid,
            session_factory,
            pg_hist,
            tracer,
            freshness_hist,
            resurrection_counter,
        ),
        on_update=lambda event, event_data, cid: _handle_update(
            event,
            event_data,
            cid,
            session_factory,
            pg_hist,
            tracer,
            freshness_hist,
            stale_counter,
        ),
        on_delete=lambda event, event_data, cid: _handle_delete(
            event, cid, session_factory, pg_hist, tracer, freshness_hist, stale_counter
        ),
        webhook_counter=webhook_counter,
        tracer=tracer,
        # Service-prefixed so this doesn't collide with another service's
        # span on the same Pub/Sub event in Cloud Trace's compact view.
        span_name="postgres_writer.webhook.process",
    )


async def _handle_create(
    event: pb.WebhookEvent,
    event_data: dict[str, Any],
    correlation_id: str,
    session_factory: sessionmaker[Session],
    pg_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
    freshness_histogram: Histogram | None = None,
    resurrection_counter: Counter | None = None,
) -> WebhookResponse:
    """Handle CREATE events - insert new activity to PostgreSQL.

    Activity data is provided inline from the dispatcher's enriched event.
    No Strava API call is needed. A CREATE that would resurrect a deleted
    activity (blocked by a deletion tombstone) is skipped, not inserted.
    """
    activity_id = event.object_id
    raw_activity = event_data.get("raw_activity")

    if raw_activity is None:
        logger.warning(
            "CREATE event missing raw_activity, skipping",
            extra={"activity_id": activity_id},
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            activity_id=activity_id,
            correlation_id=correlation_id,
            reason=SkipReason.ACTIVITY_NOT_FOUND,
        )

    # Construct StandardActivity from raw Strava API JSON.
    # ValidationError → 422 so Pub/Sub acks immediately; retrying a
    # malformed payload will fail identically.
    activity = validate_or_422(StandardActivity, raw_activity, context="raw_activity")

    # Decode the polyline BEFORE opening the transaction. It is pure CPU and
    # dominates for long routes, so doing it inside the transaction held a Neon
    # connection open across work that needs no database at all — and pooled
    # connections are the scarce resource on this path (see the open task on
    # bounding writer concurrency). Only insert_route / tag_activity_regions
    # actually need the transaction.
    #
    # Cost of hoisting: on a redelivered CREATE that turns out to be
    # ALREADY_EXISTS or RESURRECTION_BLOCKED we decode a polyline we then throw
    # away. That is the minority path (Pub/Sub at-least-once redelivery) and it
    # burns CPU we are not otherwise using, rather than a connection everything
    # else is queued behind.
    #
    # Trace shape note: postgres.polyline.decode is now a SIBLING of
    # postgres.insert rather than a child of it. The span still exists with the
    # same name and attributes, but anything that asserted on its parent will
    # see the new nesting.
    geojson: str | None = None
    if activity.map and activity.map.polyline:
        with record_span(
            tracer,
            "postgres.polyline.decode",
            {"desirelines.activity_id": activity_id},
        ):
            geojson = decode_polyline_to_geojson(activity.map.polyline)

    # Insert to PostgreSQL within transaction (no Strava API call needed).
    # The UoW emits postgres.session.acquire and postgres.commit sub-spans
    # internally; the call-site sub-spans below cover the work in between
    # so a trace shows insert / route-insert / commit latency separately.
    uow = SqlAlchemyUnitOfWork(session_factory, tracer=tracer)
    with (
        _pg_span(tracer, "postgres.insert", "INSERT", activity_id),
        record_duration(pg_histogram, {"operation": "insert"}),
        uow,
    ):
        # Sub-operation histogram: postgres.activities.insert is the single
        # slowest postgres-side step on warm Neon (the Neon cold-compute
        # signal lands here, not on session.acquire which is just TCP).
        # Recording on the same `postgres/operation.duration` histogram with
        # a sub-operation label lets the SLO task alert on it independently.
        with (
            _pg_span(tracer, "postgres.activities.insert", "INSERT", activity_id),
            record_duration(pg_histogram, {"operation": "activities_insert"}),
        ):
            insert_result = uow.activities.insert(activity, event.event_time)

        if (
            insert_result is InsertResult.INSERTED
            and activity.map
            and activity.map.polyline
        ):
            if geojson:
                with _pg_span(
                    tracer, "postgres.activities.insert_route", "INSERT", activity_id
                ):
                    uow.activities.insert_route(activity.id, geojson)

                # Region tags: every region the route crosses (+ 'earth' fallback).
                # Skipped for virtual/indoor activities — their geometry is fake/
                # absent, so they stay untagged and surface in the complementary
                # view. Runs in the same transaction as the route insert.
                if not is_non_geographic_activity(activity):
                    with _pg_span(
                        tracer, "postgres.activities.tag_regions", "INSERT", activity_id
                    ):
                        uow.activities.tag_activity_regions(activity.id)
            else:
                # Non-empty polyline that decoded to nothing usable (invalid,
                # or a valid encoding of <2 points). The route insert + region
                # tagging are skipped, so the activity lands with no geometry
                # and never appears on the map. Log it here so "activity
                # missing from map" is diagnosable from the writer's logs
                # rather than only by inspecting the DB.
                logger.warning(
                    "Activity %s has a polyline but decoded to no geometry; "
                    "route + region tagging skipped (not on map)",
                    activity_id,
                    extra={
                        "user_id": activity.user_id,
                        "polyline_length": len(activity.map.polyline),
                    },
                )

        uow.commit()

    if insert_result is InsertResult.INSERTED:
        _record_freshness(freshness_histogram, "create")

        logger.info(
            "Created activity %s in PostgreSQL",
            activity_id,
            extra={"user_id": activity.user_id},
        )
        return WebhookResponse(
            status=ResponseStatus.CREATED,
            activity_id=activity_id,
            correlation_id=correlation_id,
        )

    if insert_result is InsertResult.RESURRECTION_BLOCKED:
        if resurrection_counter is not None:
            resurrection_counter.add(1, {"aspect_type": "create"})
        logger.warning(
            "Blocked resurrecting deleted activity %s "
            "(CREATE event_time %s not newer than its deletion tombstone)",
            activity_id,
            event.event_time,
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            activity_id=activity_id,
            correlation_id=correlation_id,
            reason=SkipReason.RESURRECTION_BLOCKED,
        )

    logger.warning("Activity %s already exists (duplicate CREATE)", activity_id)
    return WebhookResponse(
        status=ResponseStatus.SKIPPED,
        activity_id=activity_id,
        correlation_id=correlation_id,
        reason=SkipReason.ALREADY_EXISTS,
    )


def _handle_update_enriched(
    activity_id: int,
    raw_activity: Any,
    event_time: int,
    correlation_id: str,
    session_factory: sessionmaker[Session],
    pg_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
    freshness_histogram: Histogram | None = None,
) -> WebhookResponse:
    """Refresh an existing activity from a re-fetched Strava payload.

    Type-change UPDATEs arrive with the full ``raw_activity`` the dispatcher
    re-fetched, so we parse it (same as CREATE) and ``upsert`` the whole row.
    This is the only path that updates the granular ``sport`` column. The
    ``upsert`` is fenced on ``event_time``: a stale/reordered event is dropped
    (and region tags are left untouched) rather than overwriting newer state.
    """
    # ValidationError → 422 so Pub/Sub acks immediately; retrying a malformed
    # payload will fail identically. Mirrors the CREATE path.
    activity = validate_or_422(StandardActivity, raw_activity, context="raw_activity")

    uow = SqlAlchemyUnitOfWork(session_factory, tracer=tracer)
    with (
        _pg_span(tracer, "postgres.upsert", "UPDATE", activity_id),
        record_duration(pg_histogram, {"operation": "upsert"}),
        uow,
    ):
        upserted = uow.activities.upsert(activity, event_time)

        # Only reconcile region tags when the upsert actually applied. A stale
        # event (fence rejected) leaves the row on its newer state, so retagging
        # from this older payload would corrupt the map. A type change may have
        # crossed the virtual boundary: now-virtual -> clear tags (drop it off
        # the map); now-real -> (re)tag from its existing route.
        # tag_activity_regions is idempotent (delete-then-insert) and
        # savepoint-isolated, so running it on every applied enriched update is
        # safe. (Edge: a virtual ride's fake polyline that's re-typed to a real
        # sport will tag to the `earth` fallback — rare; a later re-sync/backfill
        # corrects it.)
        if upserted:
            if is_non_geographic_activity(activity):
                with _pg_span(
                    tracer, "postgres.activities.clear_regions", "DELETE", activity_id
                ):
                    uow.activities.clear_activity_regions(activity_id)
            else:
                with _pg_span(
                    tracer, "postgres.activities.tag_regions", "INSERT", activity_id
                ):
                    uow.activities.tag_activity_regions(activity_id)

        uow.commit()

    if not upserted:
        # The stale-drop counter is recorded by the caller (_handle_update) so
        # both the enriched and bare paths funnel through one accounting point.
        logger.info(
            "Dropped stale enriched UPDATE for activity %s "
            "(event_time %s older than stored last_event_time)",
            activity_id,
            event_time,
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            activity_id=activity_id,
            correlation_id=correlation_id,
            reason=SkipReason.STALE_EVENT,
        )

    _record_freshness(freshness_histogram, "update")
    logger.info(
        "Refreshed activity %s from enriched UPDATE",
        activity_id,
        extra={"user_id": activity.user_id},
    )
    return WebhookResponse(
        status=ResponseStatus.UPDATED,
        activity_id=activity_id,
        correlation_id=correlation_id,
    )


async def _handle_update(
    event: pb.WebhookEvent,
    event_data: dict[str, Any],
    correlation_id: str,
    session_factory: sessionmaker[Session],
    pg_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
    freshness_histogram: Histogram | None = None,
    stale_event_counter: Counter | None = None,
) -> WebhookResponse:
    """Handle UPDATE events.

    Two legs:

    - **Enriched** (``raw_activity`` present): the dispatcher re-fetched the
      full Strava activity because the `type` changed, so we refresh the whole
      row via ``upsert`` — the only path that updates the granular ``sport``
      column correctly. Same parse path as CREATE.
    - **Bare** (no ``raw_activity``): a title/private-only change, or a
      type-change whose dispatcher fetch failed. Apply only the metadata we
      trust (``name`` / ``type``); never clobber ``sport`` with the broad type.
    """
    activity_id = event.object_id

    raw_activity = event_data.get("raw_activity")
    if raw_activity is not None:
        response = _handle_update_enriched(
            activity_id,
            raw_activity,
            event.event_time,
            correlation_id,
            session_factory,
            pg_histogram,
            tracer,
            freshness_histogram,
        )
        if response.reason == SkipReason.STALE_EVENT:
            _record_stale_drop(stale_event_counter, "update")
        return response

    updates = event.updates

    # Extract relevant updates from typed ActivityUpdates message
    relevant_updates: dict[str, str] = {}
    if updates.HasField("title"):
        relevant_updates["title"] = updates.title
    if updates.HasField("type"):
        relevant_updates["type"] = updates.type

    if not relevant_updates:
        logger.info(
            "Skipping UPDATE with no relevant changes",
            extra={
                "activity_id": activity_id,
                "has_private_update": updates.HasField("private"),
            },
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            activity_id=activity_id,
            correlation_id=correlation_id,
            reason=SkipReason.NO_RELEVANT_UPDATES,
        )

    uow = SqlAlchemyUnitOfWork(session_factory, tracer=tracer)
    with (
        _pg_span(tracer, "postgres.update_metadata", "UPDATE", activity_id),
        record_duration(pg_histogram, {"operation": "update_metadata"}),
        uow,
    ):
        # relevant_updates is non-empty (early return above), so the result is
        # UPDATED / STALE / NOT_FOUND (never NO_VALID_UPDATES). The repository
        # classifies stale-vs-not-found atomically, so no exists() probe is
        # needed here.
        result = uow.activities.update_metadata(
            activity_id, relevant_updates, event.event_time
        )
        uow.commit()

    if result is MetadataUpdateResult.UPDATED:
        _record_freshness(freshness_histogram, "update")

        logger.info(
            "Updated activity %s metadata",
            activity_id,
            extra={"updates": relevant_updates},
        )
        return WebhookResponse(
            status=ResponseStatus.UPDATED,
            activity_id=activity_id,
            correlation_id=correlation_id,
        )

    if result is MetadataUpdateResult.STALE:
        _record_stale_drop(stale_event_counter, "update")
        logger.info(
            "Dropped stale UPDATE for activity %s "
            "(event_time %s older than stored last_event_time)",
            activity_id,
            event.event_time,
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            activity_id=activity_id,
            correlation_id=correlation_id,
            reason=SkipReason.STALE_EVENT,
        )

    logger.warning(
        "Activity %s not in PostgreSQL, skipping UPDATE (no backfill)",
        activity_id,
    )
    return WebhookResponse(
        status=ResponseStatus.SKIPPED,
        activity_id=activity_id,
        correlation_id=correlation_id,
        reason=SkipReason.NOT_FOUND,
    )


async def _handle_delete(
    event: pb.WebhookEvent,
    correlation_id: str,
    session_factory: sessionmaker[Session],
    pg_histogram: Histogram | None = None,
    tracer: Tracer | None = None,
    freshness_histogram: Histogram | None = None,
    stale_event_counter: Counter | None = None,
) -> WebhookResponse:
    """Handle DELETE events - remove activity from PostgreSQL.

    Fenced: a reordered/stale DELETE that would remove a newer (re-created) row
    is dropped rather than applied.
    """
    activity_id = event.object_id
    uow = SqlAlchemyUnitOfWork(session_factory, tracer=tracer)

    with (
        _pg_span(tracer, "postgres.delete", "DELETE", activity_id),
        record_duration(pg_histogram, {"operation": "delete"}),
        uow,
    ):
        result = uow.activities.delete(activity_id, event.event_time, correlation_id)
        uow.commit()

    if result is DeleteResult.DELETED:
        _record_freshness(freshness_histogram, "delete")

        logger.info("Deleted activity %s from PostgreSQL", activity_id)
        return WebhookResponse(
            status=ResponseStatus.DELETED,
            activity_id=activity_id,
            correlation_id=correlation_id,
        )

    if result is DeleteResult.STALE:
        _record_stale_drop(stale_event_counter, "delete")
        logger.info(
            "Dropped stale DELETE for activity %s "
            "(event_time %s older than the live row's last_event_time)",
            activity_id,
            event.event_time,
        )
        return WebhookResponse(
            status=ResponseStatus.SKIPPED,
            activity_id=activity_id,
            correlation_id=correlation_id,
            reason=SkipReason.STALE_EVENT,
        )

    logger.info(
        "Activity %s not found in PostgreSQL (already deleted or never synced)",
        activity_id,
    )
    return WebhookResponse(
        status=ResponseStatus.SKIPPED,
        activity_id=activity_id,
        correlation_id=correlation_id,
        reason=SkipReason.NOT_FOUND,
    )
