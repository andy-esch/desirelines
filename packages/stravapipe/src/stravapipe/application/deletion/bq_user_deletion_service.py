"""BigQuery user deletion service for Strava deauthorization.

When a user disconnects the app from Strava, the Strava API Agreement
(Section 5.4, https://www.strava.com/legal/api) requires that all user
data is deleted within 48 hours.

This service handles the BigQuery portion of that deletion:
1. Archive activities → deleted_activities (audit trail with deletion metadata)
2. Delete from activities (primary table)
3. Delete from activities_staging (landing zone for new data)

The deleted_activities archive is intentionally retained. It serves as an
audit trail proving deletion occurred, containing only the activity data
that was present at deletion time plus deletion metadata (deleted_at,
correlation_id). This mirrors the per-activity DeleteActivityService
pattern used when individual activities are deleted via webhook.

All operations are idempotent — safe to retry on partial failure via
Pub/Sub dead-letter redelivery.
"""

from dataclasses import dataclass
import logging

from google.cloud.bigquery import ScalarQueryParameter

from stravapipe.adapters.gcp import BigQueryClientWrapper

logger = logging.getLogger(__name__)


@dataclass
class BQDeletionResult:
    """Result of BigQuery user data deletion."""

    activities_archived: int
    activities_deleted: int
    staging_deleted: int


class BQUserDeletionService:
    """Delete all BigQuery data for a user on deauthorization.

    Process:
    1. Archive activities to deleted_activities table (audit trail)
    2. Delete from activities table
    3. Delete from activities_staging table
    """

    def __init__(self, client: BigQueryClientWrapper, *, dataset_id: str):
        self._client = client
        self._dataset_id = dataset_id

    def _table(self, name: str) -> str:
        return f"`{self._client.project_id}.{self._dataset_id}.{name}`"

    def run(
        self, user_id: str, correlation_id: str, event_time: int
    ) -> BQDeletionResult:
        """Delete all BigQuery data for a user.

        All operations are idempotent — safe to retry on partial failure.

        Args:
            user_id: Strava athlete ID (string)
            correlation_id: Request correlation ID for tracing
            event_time: Strava webhook event_time (Unix timestamp)

        Returns:
            BQDeletionResult with counts of affected rows

        Raises:
            BigQueryError: If any BQ operation fails (triggers Pub/Sub retry)
        """
        user_id_param = ScalarQueryParameter("user_id", "STRING", user_id)

        # 1. Archive activities to deleted_activities
        archive_query = f"""
        INSERT INTO {self._table("deleted_activities")}
        SELECT
            *,
            CURRENT_TIMESTAMP() AS deleted_at,
            @event_time AS deletion_event_time,
            @correlation_id AS deletion_correlation_id
        FROM {self._table("activities")}
        WHERE CAST(athlete.id AS STRING) = @user_id
        """
        activities_archived = self._client.execute_dml_query(
            archive_query,
            [
                user_id_param,
                ScalarQueryParameter("event_time", "INT64", event_time),
                ScalarQueryParameter("correlation_id", "STRING", correlation_id),
            ],
        )

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
        activities_deleted = self._client.execute_dml_query(
            delete_activities, [user_id_param]
        )

        # 3. Delete from staging
        delete_staging = f"""
        DELETE FROM {self._table("activities_staging")}
        WHERE CAST(athlete.id AS STRING) = @user_id
        """
        staging_deleted = self._client.execute_dml_query(
            delete_staging, [user_id_param]
        )

        result = BQDeletionResult(
            activities_archived=activities_archived,
            activities_deleted=activities_deleted,
            staging_deleted=staging_deleted,
        )

        logger.info(
            "BQ deletion complete for user %s: %s",
            user_id,
            result,
            extra={"correlation_id": correlation_id},
        )

        return result
