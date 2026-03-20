"""Service for archiving deleted activities to BigQuery"""

import logging

from google.cloud.bigquery import ScalarQueryParameter

from stravapipe.adapters.gcp import BigQueryClientWrapper
from stravapipe.shared.constants import ResponseStatus, SkipReason
from stravapipe.shared.responses import WebhookResponse

logger = logging.getLogger(__name__)


class DeleteActivityService:
    """Archive deleted activity from activities to deleted_activities table"""

    def __init__(self, client: BigQueryClientWrapper, *, dataset_id: str):
        """Initialize the delete service with required dependencies.

        Args:
            client: BigQuery client wrapper for database operations.
            dataset_id: BigQuery dataset ID (without project prefix).
        """
        self._client = client
        self._dataset_id = dataset_id

    def _table(self, name: str) -> str:
        return f"`{self._client.project_id}.{self._dataset_id}.{name}`"

    def run(
        self,
        activity_id: int,
        correlation_id: str,
        event_time: int,
    ) -> WebhookResponse:
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
            WebhookResponse with status and metadata.

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
            return WebhookResponse(
                status=ResponseStatus.SKIPPED,
                reason=SkipReason.ACTIVITY_NOT_FOUND,
                activity_id=activity_id,
                correlation_id=correlation_id,
            )

        # Delete from activities table
        delete_query = f"""
        DELETE FROM {self._table("activities")}
        WHERE id = @activity_id
        """

        self._client.execute_dml_query(
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

        return WebhookResponse(
            status=ResponseStatus.PROCESSED,
            action=ResponseStatus.DELETED,
            activity_id=activity_id,
            correlation_id=correlation_id,
        )
