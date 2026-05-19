"""Service for archiving deleted activities to BigQuery"""

from dataclasses import dataclass
import logging

from google.cloud.bigquery import ScalarQueryParameter
from opentelemetry.trace import Tracer

from stravapipe.adapters.gcp import BigQueryClientWrapper
from stravapipe.shared.tracing import record_span

logger = logging.getLogger(__name__)


@dataclass
class BQActivityDeletionResult:
    """Result of archiving a single deleted activity to BigQuery."""

    activity_id: int
    rows_archived: int
    rows_deleted: int


class DeleteActivityService:
    """Archive deleted activity from activities to deleted_activities table"""

    def __init__(
        self,
        client: BigQueryClientWrapper,
        *,
        dataset_id: str,
        tracer: Tracer | None = None,
    ):
        """Initialize the delete service with required dependencies.

        Args:
            client: BigQuery client wrapper for database operations.
            dataset_id: BigQuery dataset ID (without project prefix).
            tracer: Optional OTel tracer. When set, the archive INSERT and
                activity DELETE jobs each get their own sub-span so DML latency
                can be attributed to the right step.
        """
        self._client = client
        self._dataset_id = dataset_id
        self._tracer = tracer

    def _table(self, name: str) -> str:
        return f"`{self._client.project_id}.{self._dataset_id}.{name}`"

    def run(
        self,
        activity_id: int,
        correlation_id: str,
        event_time: int,
    ) -> BQActivityDeletionResult:
        """Archive deleted activity from activities to deleted_activities table.

        Process:
        1. INSERT INTO deleted_activities SELECT * FROM activities WHERE id = X
           (BigQuery handles data transfer directly)
        2. DELETE FROM activities WHERE id = X
        3. Log success

        Args:
            activity_id: Strava activity ID to delete.
            correlation_id: Request correlation ID for tracing.
            event_time: Strava webhook event_time.

        Returns:
            BQActivityDeletionResult with row counts. ``rows_archived == 0``
            indicates the activity was not found (and ``rows_deleted`` will
            also be 0 because the DELETE step is skipped).

        Raises:
            BigQueryError: If archiving fails (will trigger retry via DLQ).
        """
        logger.info(
            "Processing delete event for activity %s",
            activity_id,
            extra={"correlation_id": correlation_id, "activity_id": activity_id},
        )

        # Archive activity into deleted_activities
        insert_query = f"""
        INSERT INTO {self._table("deleted_activities")}
        SELECT
            *,
            CURRENT_TIMESTAMP() AS deleted_at,
            @event_time AS deletion_event_time,
            @correlation_id AS deletion_correlation_id
        FROM {self._table("activities")}
        WHERE id = @activity_id
        """

        with record_span(
            self._tracer,
            "bigquery.archive_insert",
            {"desirelines.activity_id": activity_id},
        ):
            rows_archived = self._client.execute_dml_query(
                insert_query,
                [
                    ScalarQueryParameter("activity_id", "INT64", activity_id),
                    ScalarQueryParameter("event_time", "INT64", event_time),
                    ScalarQueryParameter("correlation_id", "STRING", correlation_id),
                ],
            )

        if rows_archived == 0:
            logger.warning(
                "Activity %s not found for deletion (may have been deleted already)",
                activity_id,
                extra={"correlation_id": correlation_id},
            )
            return BQActivityDeletionResult(
                activity_id=activity_id,
                rows_archived=0,
                rows_deleted=0,
            )

        # Delete from activities table
        delete_query = f"""
        DELETE FROM {self._table("activities")}
        WHERE id = @activity_id
        """

        with record_span(
            self._tracer,
            "bigquery.activity_delete",
            {"desirelines.activity_id": activity_id},
        ):
            rows_deleted = self._client.execute_dml_query(
                delete_query,
                [ScalarQueryParameter("activity_id", "INT64", activity_id)],
            )

        logger.info(
            "Successfully archived deleted activity %s",
            activity_id,
            extra={
                "correlation_id": correlation_id,
                "activity_id": activity_id,
                "event_time": event_time,
            },
        )

        return BQActivityDeletionResult(
            activity_id=activity_id,
            rows_archived=rows_archived,
            rows_deleted=rows_deleted,
        )
