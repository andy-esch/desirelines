"""BigQuery user deletion service for Strava deauthorization.

When a user disconnects the app from Strava, the Strava API Agreement
(Section 5.4, https://www.strava.com/legal/api) requires that all user
data is deleted within 48 hours.

This service handles the BigQuery portion of that deletion, removing the
athlete's rows from every table that holds them:

1. activities        — the legacy table written by bq-inserter
2. activities_staging — its landing zone
3. activities_live   — the CDC table written by the Pub/Sub subscription

**The record of a deletion is the log line, not a table.** An earlier version
copied every row into a `deleted_activities` table first, described as an audit
trail. It was not one: 64 of its 67 columns were the activity payload —
athlete, route polylines, start/end coordinates, photos, description — so a
deauthorization moved the data rather than deleting it, under a name that read
as handled. Proving a deletion happened needs the athlete id, a timestamp, a
row count and a correlation id; it does not need the data that was deleted.
Those four are logged below and retained in Cloud Logging.

DML rather than CDC deletes for `activities_live`, deliberately. A per-activity
delete already flows through CDC — the dispatcher publishes `_CHANGE_TYPE=DELETE`
and the subscription applies it — but a deauthorization removes every activity an
athlete has, which as CDC messages would be one publish per activity (thousands
for an established account) and eventually consistent, against a single DML
statement that returns the row count it deleted.

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
                """,
                [user_id_param],
            )

        activities_deleted = purge("activities")
        staging_deleted = purge("activities_staging")
        live_deleted = purge("activities_live")

        # This is the deletion record. It carries what proving a deletion
        # requires — who, when, how much, and the correlation id to tie it to
        # the deauthorization event — and none of what was deleted.
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
