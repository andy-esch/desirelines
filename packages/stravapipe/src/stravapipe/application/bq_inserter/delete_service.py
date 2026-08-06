"""Remove a deleted activity from the legacy BigQuery activities table.

This previously copied the activity into a `deleted_activities` table before
deleting it, described as an audit trail. It was not one — the copy carried the
whole activity payload, so a deletion moved the data rather than removing it.
The record of a deletion is now the log line below.

Legacy path. The CDC subscription already deletes natively: the dispatcher
publishes `_CHANGE_TYPE=DELETE` and BigQuery removes the row from
`activities_live` with no DML and no service. This exists only for the
`activities` table and retires with it.
"""

from dataclasses import dataclass
import logging

from google.cloud.bigquery import ScalarQueryParameter
from opentelemetry.trace import Tracer

from stravapipe.adapters.gcp import BigQueryClientWrapper
from stravapipe.shared.tracing import db_attributes, record_span

logger = logging.getLogger(__name__)


@dataclass
class BQActivityDeletionResult:
    """Result of deleting a single activity from BigQuery."""

    activity_id: int
    rows_deleted: int


class DeleteActivityService:
    """Delete a single activity from the legacy `activities` table."""

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
            BQActivityDeletionResult. ``rows_deleted == 0`` indicates the
            activity was not in the table — already deleted, or never
            inserted.

        Raises:
            BigQueryError: If archiving fails (will trigger retry via DLQ).
        """
        logger.info(
            "Processing delete event for activity %s",
            activity_id,
            extra={"correlation_id": correlation_id, "activity_id": activity_id},
        )

        # Delete from activities table
        delete_query = f"""
        DELETE FROM {self._table("activities")}
        WHERE id = @activity_id
        """

        with record_span(
            self._tracer,
            "bigquery.activity_delete",
            db_attributes(
                "bigquery",
                self._dataset_id,
                "DELETE",
                {"desirelines.activity_id": activity_id},
            ),
        ):
            rows_deleted = self._client.execute_dml_query(
                delete_query,
                [ScalarQueryParameter("activity_id", "INT64", activity_id)],
            )

        logger.info(
            "Deleted activity %s from BigQuery",
            activity_id,
            extra={
                "correlation_id": correlation_id,
                "activity_id": activity_id,
                "event_time": event_time,
            },
        )

        return BQActivityDeletionResult(
            activity_id=activity_id,
            rows_deleted=rows_deleted,
        )
