"""Service for archiving deleted activities to BigQuery"""

import logging

from google.cloud import bigquery

logger = logging.getLogger(__name__)


class DeleteActivityService:
    """Archive deleted activity from activities to deleted_activities table"""

    def __init__(self, bq_client: bigquery.Client, project_id: str, dataset_id: str):
        """Initialize the delete service with required dependencies.

        Args:
            bq_client: BigQuery client for database operations.
            project_id: GCP project ID.
            dataset_id: BigQuery dataset ID (without project prefix).
        """
        self.bq_client = bq_client
        self.project_id = project_id
        self.dataset_id = dataset_id

    def run(
        self,
        activity_id: int,
        correlation_id: str,
        event_time: int,
    ) -> dict[str, any]:
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
            dict: Result with status and metadata.

        Raises:
            Exception: If archiving fails (will trigger retry via DLQ).
        """
        logger.info(
            "Processing delete event for activity %s",
            activity_id,
            extra={"correlation_id": correlation_id, "activity_id": activity_id},
        )

        # Archive activity into deleted_activity
        insert_query = f"""
        INSERT INTO `{self.project_id}.{self.dataset_id}.deleted_activities`
        SELECT
            *,  -- All columns from activities table
            CURRENT_TIMESTAMP() AS deleted_at,
            @event_time AS deletion_event_time,
            @correlation_id AS deletion_correlation_id
        FROM `{self.project_id}.{self.dataset_id}.activities`
        WHERE id = @activity_id
        """

        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("activity_id", "INT64", activity_id),
                bigquery.ScalarQueryParameter("event_time", "INT64", event_time),
                bigquery.ScalarQueryParameter(
                    "correlation_id", "STRING", correlation_id
                ),
            ]
        )

        try:
            logger.info(
                "Archiving activity %s to deleted_activities table",
                activity_id,
                extra={"correlation_id": correlation_id},
            )

            query_job = self.bq_client.query(insert_query, job_config=job_config)
            _ = query_job.result()

            # Check if any rows were inserted
            if query_job.num_dml_affected_rows == 0:
                logger.warning(
                    "Activity %s not found for deletion (may have been deleted already)",
                    activity_id,
                    extra={"correlation_id": correlation_id},
                )
                return {
                    "status": "skipped",
                    "reason": "activity_not_found",
                    "activity_id": activity_id,
                }

        except Exception as e:
            logger.error(
                "Failed to archive activity %s: %s",
                activity_id,
                str(e),
                extra={"correlation_id": correlation_id},
            )
            raise  # Re-raise to trigger retry

        # Delete from activities table
        delete_query = f"""
        DELETE FROM `{self.project_id}.{self.dataset_id}.activities`
        WHERE id = @activity_id
        """

        delete_job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("activity_id", "INT64", activity_id),
            ]
        )

        try:
            self.bq_client.query(delete_query, job_config=delete_job_config).result()
        except Exception as e:
            logger.error(
                "Failed to delete activity %s from activities table: %s",
                activity_id,
                str(e),
                extra={"correlation_id": correlation_id},
            )
            raise  # Re-raise to trigger retry

        logger.info(
            "Successfully archived deleted activity %s",
            activity_id,
            extra={
                "correlation_id": correlation_id,
                "activity_id": activity_id,
                "event_time": event_time,
            },
        )

        return {
            "status": "processed",
            "action": "deleted",
            "activity_id": activity_id,
        }
