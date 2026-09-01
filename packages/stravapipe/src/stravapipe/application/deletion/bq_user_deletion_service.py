"""Delete an athlete's BigQuery data on Strava deauthorization.

Required within 48 hours by the Strava API Agreement §5.4
(https://www.strava.com/legal/api). Covers every table holding activity rows:
`activities`, `activities_staging`, and `activities_live`.

Nothing is archived. The deletion record is the log line below — athlete id,
row counts, correlation id — which is what evidences a deletion without
retaining what was deleted.

DML rather than CDC deletes for `activities_live`: a deauthorization removes
every activity an athlete has, which as CDC messages would be one publish each
and eventually consistent, against one statement that returns its row count.

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

    activities_deleted: int
    staging_deleted: int
    live_deleted: int


class BQUserDeletionService:
    """Delete all BigQuery data for a user on deauthorization.

    Process:
    1. Delete from activities
    2. Delete from activities_staging
    3. Delete from activities_live
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

        def purge(table: str) -> int:
            """Delete the athlete's rows from one table."""
            return self._client.execute_dml_query(
                f"""
                DELETE FROM {self._table(table)}
                WHERE CAST(athlete.id AS STRING) = @user_id
                """,  # noqa: S608 -- table name from hardcoded purge() args; user_id bound via @user_id
                [user_id_param],
            )

        activities_deleted = purge("activities")
        staging_deleted = purge("activities_staging")
        live_deleted = purge("activities_live")

        # The deletion record: who, when, how much — and none of what was
        # deleted. Retained in Cloud Logging.
        logger.info(
            "Deleted BigQuery data for user %s: activities=%d staging=%d live=%d",
            user_id,
            activities_deleted,
            staging_deleted,
            live_deleted,
            extra={"correlation_id": correlation_id, "event_time": event_time},
        )

        return BQDeletionResult(
            activities_deleted=activities_deleted,
            staging_deleted=staging_deleted,
            live_deleted=live_deleted,
        )
