"""FastAPI application for the user deletion Cloud Run service.

Implements user data deletion required by the Strava API Agreement (Section
5.4, https://www.strava.com/legal/api): all user data must be deleted within
48 hours of deauthorization.

Triggered by deauth events on the deauth_events Pub/Sub topic. When a user
disconnects the app from Strava, this service deletes their data from all
stores:

- PostgreSQL: activities + routes (CASCADE)
- BigQuery: archive to deleted_activities (audit trail), then delete from
  activities and activities_staging
- Firestore: OAuth tokens, user profile, config, allowlist entry

All deletions are idempotent. On partial failure, returns 500 to trigger
Pub/Sub retry via dead-letter redelivery.

Does NOT use handle_webhook_cloudevent() since that function hardcodes
object_type == ACTIVITY routing. This service handles athlete deauth events
with a simpler flow: parse event → extract owner_id → delete from all stores.
"""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from google.cloud.firestore_v1 import Client as FirestoreClient
from opentelemetry.metrics import Histogram
from opentelemetry.trace import Tracer, get_current_span
from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.firestore import FirestoreTokenStore
from stravapipe.adapters.gcp import BigQueryClientWrapper
from stravapipe.adapters.postgres import SqlAlchemyUnitOfWork
from stravapipe.adapters.postgres._unit_of_work import create_session_factory
from stravapipe.application.deletion import BQUserDeletionService
from stravapipe.cloudrun._request_context import bootstrap_pubsub_request
from stravapipe.config import load_deletion_service_config
from stravapipe.shared.constants import ResponseStatus
from stravapipe.shared.logging import setup_logging
from stravapipe.shared.metrics import record_duration, setup_metrics, shutdown_metrics
from stravapipe.shared.readiness import (
    build_ready_response,
    check_bigquery,
    check_firestore,
    register_health_route,
    run_checks,
)
from stravapipe.shared.responses import UserDeletionResponse
from stravapipe.shared.tracing import (
    instrument_fastapi_app,
    instrument_sqlalchemy_engine,
    record_span,
    setup_tracing,
    shutdown_tracing,
)

logger = setup_logging(__name__)

# Firestore path constants — must match Go shared/stravatoken/types.go
USERS_COLLECTION = "users"


@dataclass
class DeletionResult:
    """Tracks results across all stores for a single user deletion."""

    user_id: str
    pg_deleted: int = 0
    bq_activities_deleted: int = 0
    bq_staging_deleted: int = 0
    firestore_tokens_deleted: bool = False
    firestore_user_docs_deleted: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        return len(self.errors) > 0


def _try_delete_step(
    result: DeletionResult,
    tracer: Tracer | None,
    deletion_hist: Histogram | None,
    store_name: str,
    work: Callable[[], None],
) -> None:
    """Run one per-store deletion step with the shared span/duration/error frame.

    Each store deletion follows the same shape: open a span tagged with
    `deletion.<store>`, time it on the deletion histogram, run the store-
    specific work, and on failure record the error onto the shared
    DeletionResult so downstream stores still get a chance to run. Pulled out
    of handle_deauth_event so the orchestrator stays under ruff's branch /
    statement caps and per-store logic is unit-testable in isolation.
    """
    try:
        with (
            record_span(
                tracer,
                f"deletion.{store_name}",
                {"desirelines.user_id": result.user_id},
            ),
            record_duration(deletion_hist, {"store": store_name}),
        ):
            work()
    except Exception as e:
        result.errors.append(f"{store_name}: {e}")
        logger.exception("%s deletion failed for user %s", store_name, result.user_id)


@dataclass
class _DeletionDeps:
    """Bundles the per-store clients + telemetry handles needed by
    _delete_all_stores. Exists only to keep the orchestrator's signature
    short — there's no behavior here."""

    session_factory: sessionmaker[Session]
    bq_service: BQUserDeletionService
    token_store: FirestoreTokenStore
    firestore_client: FirestoreClient
    tracer: Tracer | None
    deletion_hist: Histogram | None


def _delete_all_stores(
    result: DeletionResult,
    deps: _DeletionDeps,
    correlation_id: str,
    event_time: int,
) -> None:
    """Run the four per-store deletion steps in order, mutating `result`.

    Each step is independent and idempotent — failures are recorded on
    `result.errors` and the next step still runs. Splitting this out of
    handle_deauth_event keeps the orchestrator under ruff's PLR0915 cap
    while leaving the operational sequence (postgres → bigquery → tokens →
    docs) plainly visible.
    """
    user_id = result.user_id

    def _do_postgres() -> None:
        uow = SqlAlchemyUnitOfWork(deps.session_factory)
        with uow:
            result.pg_deleted = uow.activities.delete_by_user(user_id)
            uow.commit()
        logger.info(
            "Deleted %d activities from PostgreSQL for user %s",
            result.pg_deleted,
            user_id,
        )

    def _do_bigquery() -> None:
        bq_result = deps.bq_service.run(user_id, correlation_id, event_time)
        result.bq_activities_deleted = bq_result.activities_deleted
        result.bq_staging_deleted = bq_result.staging_deleted

    def _do_firestore_tokens() -> None:
        deps.token_store.delete_tokens(user_id)
        result.firestore_tokens_deleted = True

    def _do_firestore_docs() -> None:
        result.firestore_user_docs_deleted = _delete_firestore_user_docs(
            deps.firestore_client, user_id
        )

    _try_delete_step(result, deps.tracer, deps.deletion_hist, "postgres", _do_postgres)
    _try_delete_step(result, deps.tracer, deps.deletion_hist, "bigquery", _do_bigquery)
    _try_delete_step(
        result,
        deps.tracer,
        deps.deletion_hist,
        "firestore_tokens",
        _do_firestore_tokens,
    )
    _try_delete_step(
        result,
        deps.tracer,
        deps.deletion_hist,
        "firestore_docs",
        _do_firestore_docs,
    )


def _delete_firestore_user_docs(
    firestore_client: FirestoreClient,
    user_id: str,
) -> int:
    """Delete all Firestore documents for a user.

    Documents:
    - users/{user_id}/private/strava_tokens (handled by token_store.delete_tokens)
    - users/{user_id}/private/profile
    - users/{user_id}/config/v1
    - allowlist/{user_id}

    All deletes are idempotent — non-existent documents are silently skipped.
    """
    count = 0
    user_ref = firestore_client.collection(USERS_COLLECTION).document(user_id)

    # Delete subcollection documents
    subcollection_docs = [
        user_ref.collection("private").document("profile"),
        user_ref.collection("config").document("v1"),
    ]
    for doc_ref in subcollection_docs:
        doc_ref.delete()
        count += 1

    # Delete allowlist entry
    firestore_client.collection("allowlist").document(user_id).delete()
    count += 1

    return count


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize shared resources on startup and ensure clean shutdown."""
    try:
        config = load_deletion_service_config()
        logger.info("Deletion service configuration validated successfully")

        # PostgreSQL
        app.state.db_engine, app.state.session_factory = create_session_factory(
            config.postgres_connection_string
        )
        logger.info("PostgreSQL session factory initialized")

        # BigQuery
        bq_client = BigQueryClientWrapper(project_id=config.project_id)
        app.state.bq_client = bq_client
        app.state.bq_dataset = config.bq_dataset
        app.state.bq_deletion_service = BQUserDeletionService(
            bq_client, dataset_id=config.bq_dataset
        )
        logger.info("BigQuery deletion service initialized")

        # Firestore
        firestore_client = FirestoreClient(
            project=config.project_id,
            database=config.firestore_database,
        )
        app.state.firestore_client = firestore_client
        app.state.token_store = FirestoreTokenStore(firestore_client)
        logger.info("Firestore client initialized")

        app.state.readiness_timeout = config.readiness_timeout

        # OTel metrics
        meter = setup_metrics("desirelines-deletion-service")
        app.state.deletion_histogram = meter.create_histogram(
            "desirelines.io/deletion/operation.duration",
            unit="ms",
            description="User deletion operation duration",
        )
        app.state.deletion_counter = meter.create_counter(
            "desirelines.io/deletion/events",
            description="User deletion events processed",
        )

        # Initialize OTel tracing
        app.state.tracer = setup_tracing("desirelines-deletion-service")

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
        engine = getattr(app.state, "db_engine", None)
        if engine is not None:
            engine.dispose()
            logger.info("PostgreSQL engine disposed")

        # shutdown_metrics and shutdown_tracing are safe to call multiple times
        # and handle the case where they haven't been initialized (provider is None).
        shutdown_metrics()
        shutdown_tracing()
        logger.info("OTel resources shutdown")


app = FastAPI(
    title="Deletion Service",
    description="Deletes all user data on Strava deauthorization",
    lifespan=lifespan,
)


register_health_route(app)


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness probe — verifies BigQuery and Firestore. Hit hourly by Cloud Scheduler."""
    bq_client = request.app.state.bq_client
    dataset_id = request.app.state.bq_dataset
    firestore_client = request.app.state.firestore_client
    checks = await run_checks(
        {
            "bigquery": lambda: check_bigquery(bq_client, dataset_id),
            "firestore": lambda: check_firestore(firestore_client),
        },
        timeout=request.app.state.readiness_timeout,
    )
    return build_ready_response(checks)


@app.post("/")
async def handle_deauth_event(request: Request) -> UserDeletionResponse:
    """Handle deauth event from Pub/Sub.

    Deletes user data from all stores. Proceeds through all stores even if
    one fails — all deletions are idempotent, so retries are safe.
    If any deletion fails, raises 500 to trigger Pub/Sub retry.
    """

    try:
        # bootstrap_pubsub_request sets a fallback correlation_id on the
        # contextvar as its first step, so logging in the except blocks below
        # carries one even if it raises before parsing completes.
        req = await bootstrap_pubsub_request(request)
        context = req.context
        event_data = req.event_data
        correlation_id = req.correlation_id

        tracer = request.app.state.tracer

        # IMPORTANT: The span must wrap ALL log statements below. The
        # google-cloud-logging library reads the active OTel span and
        # populates trace/spanId/traceSampled on each log entry. Logs
        # emitted outside this block will not be linked to the trace in
        # Cloud Trace and will be invisible when viewing "Show logs" on
        # a trace. If you add new log lines, keep them inside this span.
        with record_span(
            tracer,
            "deletion.process",
            attributes=req.span_attrs,
            parent_context=req.parent_context,
        ):
            logger.info(
                "Received deauth CloudEvent",
                extra={
                    "event_type": context.event_type,
                    "event_id": context.event_id,
                    "pubsub_message_id": context.pubsub_message_id,
                    "delivery_attempt": context.delivery_attempt,
                },
            )

            owner_id = event_data.get("owner_id")
            if not owner_id:
                raise HTTPException(  # noqa: TRY301 — FastAPI idiom; `except HTTPException: raise` passthrough below preserves status code
                    status_code=422,
                    detail="Missing owner_id in deauth event",
                )

            user_id = str(owner_id)
            event_time = event_data.get("event_time", 0)
            result = DeletionResult(user_id=user_id)

            # Set user_id on span now that we know it.
            get_current_span().set_attribute("desirelines.user_id", user_id)

            deps = _DeletionDeps(
                session_factory=request.app.state.session_factory,
                bq_service=request.app.state.bq_deletion_service,
                token_store=request.app.state.token_store,
                firestore_client=request.app.state.firestore_client,
                tracer=tracer,
                deletion_hist=request.app.state.deletion_histogram,
            )
            _delete_all_stores(result, deps, correlation_id, event_time)

            # Record metric
            if request.app.state.deletion_counter:
                request.app.state.deletion_counter.add(
                    1,
                    {
                        "result": "partial_failure" if result.has_errors else "success",
                    },
                )

            if result.has_errors:
                logger.error(
                    "User deletion partially failed for user %s: %s",
                    user_id,
                    result.errors,
                )
                raise HTTPException(  # noqa: TRY301 — FastAPI idiom; passthrough via `except HTTPException: raise` preserves 500 status
                    status_code=500,
                    detail=f"Partial deletion failure: {result.errors}",
                )

            logger.info(
                "User deletion complete for user %s",
                user_id,
                extra={
                    "pg_deleted": result.pg_deleted,
                    "bq_activities_deleted": result.bq_activities_deleted,
                    "bq_staging_deleted": result.bq_staging_deleted,
                    "firestore_docs_deleted": result.firestore_user_docs_deleted,
                },
            )

            return UserDeletionResponse(
                status=ResponseStatus.DELETED,
                correlation_id=correlation_id,
                user_id=user_id,
                pg_deleted=result.pg_deleted,
                bq_activities_deleted=result.bq_activities_deleted,
                bq_staging_deleted=result.bq_staging_deleted,
            )

    except HTTPException:
        raise
    except Exception as err:
        logger.exception("Unexpected error")
        raise HTTPException(
            status_code=500, detail="An internal server error occurred."
        ) from err
