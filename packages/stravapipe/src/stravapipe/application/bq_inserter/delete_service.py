"""Remove a deleted activity from the legacy BigQuery `activities` table.

Legacy path — `activities_live` needs no equivalent, since the CDC subscription
applies the dispatcher's `_CHANGE_TYPE=DELETE` natively. Retires with the table.
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
        """Delete one activity from the `activities` table.

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
