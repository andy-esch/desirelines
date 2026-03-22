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

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import uuid

from fastapi import FastAPI, HTTPException, Request
from google.cloud.firestore_v1 import Client as FirestoreClient

from stravapipe.adapters.firestore import FirestoreTokenStore
from stravapipe.adapters.gcp import BigQueryClientWrapper
from stravapipe.adapters.postgres import SqlAlchemyUnitOfWork
from stravapipe.adapters.postgres._unit_of_work import create_session_factory
from stravapipe.application.deletion import BQUserDeletionService
from stravapipe.cloudrun.pubsub import parse_pubsub_cloudevent
from stravapipe.config import load_deletion_service_config
from stravapipe.shared.constants import ResponseStatus
from stravapipe.shared.logging import setup_logging
from stravapipe.shared.metrics import record_duration, setup_metrics, shutdown_metrics
from stravapipe.shared.responses import HealthResponse, UserDeletionResponse
from stravapipe.shared.tracing import (
    extract_context_from_attributes,
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
async def lifespan(app: FastAPI):
    """Initialize shared resources on startup."""
    try:
        config = load_deletion_service_config()
        logger.info("Deletion service configuration validated successfully")

        # PostgreSQL
        app.state.session_factory = create_session_factory(
            config.postgres_connection_string
        )
        logger.info("PostgreSQL session factory initialized")

        # BigQuery
        bq_client = BigQueryClientWrapper(project_id=config.project_id)
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
    except Exception as e:
        logger.error("Startup initialization failed: %s", e)
        raise
    yield
    shutdown_metrics()
    shutdown_tracing()


app = FastAPI(
    title="Deletion Service",
    description="Deletes all user data on Strava deauthorization",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    """Health check endpoint for Cloud Run."""
    return HealthResponse(status=ResponseStatus.HEALTHY)


@app.post("/")
async def handle_deauth_event(request: Request):
    """Handle deauth event from Pub/Sub.

    Deletes user data from all stores. Proceeds through all stores even if
    one fails — all deletions are idempotent, so retries are safe.
    If any deletion fails, raises 500 to trigger Pub/Sub retry.
    """

    correlation_id = str(uuid.uuid4())

    try:
        context, event_data, message_attributes = await parse_pubsub_cloudevent(request)

        # Prefer dispatcher's correlation_id over the pre-generated fallback.
        correlation_id = message_attributes.get("correlation_id") or correlation_id

        # Extract W3C trace context from dispatcher's traceparent header.
        parent_context = extract_context_from_attributes(message_attributes)
        tracer = request.app.state.tracer

        logger.info(
            "Received deauth CloudEvent",
            extra={
                "correlation_id": correlation_id,
                "event_type": context.event_type,
                "event_id": context.event_id,
            },
        )

        owner_id = event_data.get("owner_id")
        if not owner_id:
            raise HTTPException(
                status_code=422,
                detail="Missing owner_id in deauth event",
            )

        user_id = str(owner_id)
        event_time = event_data.get("event_time", 0)
        result = DeletionResult(user_id=user_id)

        session_factory = request.app.state.session_factory
        bq_service: BQUserDeletionService = request.app.state.bq_deletion_service
        token_store: FirestoreTokenStore = request.app.state.token_store
        firestore_client: FirestoreClient = request.app.state.firestore_client
        deletion_hist = request.app.state.deletion_histogram

        with record_span(
            tracer,
            "deletion.process",
            attributes={"user_id": user_id},
            parent_context=parent_context,
        ):
            # 1. Delete from PostgreSQL
            try:
                with record_span(tracer, "deletion.postgres", {"user_id": user_id}):
                    with record_duration(deletion_hist, {"store": "postgres"}):
                        uow = SqlAlchemyUnitOfWork(session_factory)
                        with uow:
                            result.pg_deleted = uow.activities.delete_by_user(user_id)
                            uow.commit()
                logger.info(
                    "Deleted %d activities from PostgreSQL for user %s",
                    result.pg_deleted,
                    user_id,
                    extra={"correlation_id": correlation_id},
                )
            except Exception as e:
                result.errors.append(f"postgres: {e}")
                logger.error(
                    "PostgreSQL deletion failed for user %s: %s",
                    user_id,
                    e,
                    extra={"correlation_id": correlation_id},
                )

            # 2. Delete from BigQuery
            try:
                with record_span(tracer, "deletion.bigquery", {"user_id": user_id}):
                    with record_duration(deletion_hist, {"store": "bigquery"}):
                        bq_result = bq_service.run(user_id, correlation_id, event_time)
                result.bq_activities_deleted = bq_result.activities_deleted
                result.bq_staging_deleted = bq_result.staging_deleted
            except Exception as e:
                result.errors.append(f"bigquery: {e}")
                logger.error(
                    "BigQuery deletion failed for user %s: %s",
                    user_id,
                    e,
                    extra={"correlation_id": correlation_id},
                )

            # 3. Delete Firestore tokens (backup to dispatcher's best-effort delete)
            try:
                with record_span(
                    tracer, "deletion.firestore_tokens", {"user_id": user_id}
                ):
                    with record_duration(deletion_hist, {"store": "firestore_tokens"}):
                        token_store.delete_tokens(user_id)
                result.firestore_tokens_deleted = True
            except Exception as e:
                result.errors.append(f"firestore_tokens: {e}")
                logger.error(
                    "Firestore token deletion failed for user %s: %s",
                    user_id,
                    e,
                    extra={"correlation_id": correlation_id},
                )

            # 4. Delete remaining Firestore user documents
            try:
                with record_span(
                    tracer, "deletion.firestore_docs", {"user_id": user_id}
                ):
                    with record_duration(deletion_hist, {"store": "firestore_docs"}):
                        result.firestore_user_docs_deleted = (
                            _delete_firestore_user_docs(firestore_client, user_id)
                        )
            except Exception as e:
                result.errors.append(f"firestore_docs: {e}")
                logger.error(
                    "Firestore document deletion failed for user %s: %s",
                    user_id,
                    e,
                    extra={"correlation_id": correlation_id},
                )

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
                extra={"correlation_id": correlation_id},
            )
            raise HTTPException(
                status_code=500,
                detail=f"Partial deletion failure: {result.errors}",
            )

        logger.info(
            "User deletion complete for user %s",
            user_id,
            extra={
                "correlation_id": correlation_id,
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
        logger.error(
            "Unexpected error: %s",
            err,
            extra={"correlation_id": correlation_id},
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail="An internal server error occurred."
        ) from err
