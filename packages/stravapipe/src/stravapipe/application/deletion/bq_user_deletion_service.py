"""BigQuery user deletion service.

Archives and deletes all BigQuery data for a user during deauthorization.
Follows the archive-then-delete pattern from DeleteActivityService but
operates by user_id across all BQ tables.
"""

from dataclasses import dataclass
import logging

from google.cloud import bigquery

logger = logging.getLogger(__name__)


@dataclass
class BQDeletionResult:
    """Result of BigQuery user data deletion."""

    activities_archived: int
    activities_deleted: int
    staging_deleted: int
    archive_deleted: int


class BQUserDeletionService:
    """Delete all BigQuery data for a user.

    Process:
    1. Archive activities to deleted_activities table
    2. Delete from activities table
    3. Delete from activities_staging table
    4. Delete from deleted_activities table (cleanup after archive)
    """

    def __init__(self, bq_client: bigquery.Client, project_id: str, dataset_id: str):
        self.bq_client = bq_client
        self.project_id = project_id
        self.dataset_id = dataset_id

    def _table(self, name: str) -> str:
        return f"`{self.project_id}.{self.dataset_id}.{name}`"

    def run(self, user_id: str, correlation_id: str) -> BQDeletionResult:
        """Delete all BigQuery data for a user.

        All operations are idempotent — safe to retry on partial failure.

        Args:
            user_id: Strava athlete ID (string)
            correlation_id: Request correlation ID for tracing

        Returns:
            BQDeletionResult with counts of affected rows

        Raises:
            Exception: If any BQ operation fails (triggers Pub/Sub retry)
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("user_id", "STRING", user_id),
                bigquery.ScalarQueryParameter(
                    "correlation_id", "STRING", correlation_id
                ),
            ]
        )

        # 1. Archive activities to deleted_activities
        archive_query = f"""
        INSERT INTO {self._table("deleted_activities")}
        SELECT
            *,
            CURRENT_TIMESTAMP() AS deleted_at,
            0 AS deletion_event_time,
            @correlation_id AS deletion_correlation_id
        FROM {self._table("activities")}
        WHERE CAST(athlete.id AS STRING) = @user_id
        """
        archive_job = self.bq_client.query(archive_query, job_config=job_config)
        archive_job.result()
        activities_archived = archive_job.num_dml_affected_rows or 0

        logger.info(
            "Archived %d activities for user %s",
            activities_archived,
            user_id,
            extra={"correlation_id": correlation_id},
        )

        # 2. Delete from activities
        delete_activities = f"""
        DELETE FROM {self._table("activities")}
        WHERE CAST(athlete.id AS STRING) = @user_id
        """
        del_job = self.bq_client.query(delete_activities, job_config=job_config)
        del_job.result()
        activities_deleted = del_job.num_dml_affected_rows or 0

        # 3. Delete from staging
        delete_staging = f"""
        DELETE FROM {self._table("activities_staging")}
        WHERE CAST(athlete.id AS STRING) = @user_id
        """
        staging_job = self.bq_client.query(delete_staging, job_config=job_config)
        staging_job.result()
        staging_deleted = staging_job.num_dml_affected_rows or 0

        # 4. Delete from deleted_activities archive
        delete_archive = f"""
        DELETE FROM {self._table("deleted_activities")}
        WHERE CAST(athlete.id AS STRING) = @user_id
        """
        archive_del_job = self.bq_client.query(delete_archive, job_config=job_config)
        archive_del_job.result()
        archive_deleted = archive_del_job.num_dml_affected_rows or 0

        result = BQDeletionResult(
            activities_archived=activities_archived,
            activities_deleted=activities_deleted,
            staging_deleted=staging_deleted,
            archive_deleted=archive_deleted,
        )

        logger.info(
            "BQ deletion complete for user %s: %s",
            user_id,
            result,
            extra={"correlation_id": correlation_id},
        )

        return result
