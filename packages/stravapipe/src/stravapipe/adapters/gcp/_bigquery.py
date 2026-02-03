"""BigQuery adapter for reading and writing Strava activities."""

import logging

from google.api_core.exceptions import BadRequest
from google.cloud import bigquery
from google.cloud.bigquery import ArrayQueryParameter, ScalarQueryParameter

from stravapipe.adapters.gcp._clients import BigQueryClientWrapper, MergeResult
from stravapipe.domain import (
    DetailedStravaActivity,
    MinimalStravaActivity,
    SummaryStravaActivity,
)
from stravapipe.exceptions import ActivityNotFoundError, BigQueryError
from stravapipe.ports.out.read import ReadActivitiesMetadata
from stravapipe.ports.out.write import WriteActivities

logger = logging.getLogger(__name__)


class ActivitiesRepo(WriteActivities, ReadActivitiesMetadata):
    """Read and write Strava Activities to/from BigQuery"""

    # BigQuery streaming insert limit per API call
    # https://cloud.google.com/bigquery/quotas#streaming_inserts
    _MAX_BATCH_SIZE: int = 10_000

    # Column definitions for MERGE queries (single source of truth)
    # These are all columns that can be updated/inserted, excluding 'id' (the key)
    _MERGE_COLUMNS: tuple[str, ...] = (
        "external_id",
        "upload_id",
        "athlete",
        "name",
        "distance",
        "moving_time",
        "elapsed_time",
        "total_elevation_gain",
        "elev_high",
        "elev_low",
        "type",
        "sport_type",
        "start_date",
        "start_date_local",
        "timezone",
        "achievement_count",
        "athlete_count",
        "average_speed",
        "calories",
        "comment_count",
        "commute",
        "embed_token",
        "flagged",
        "has_heartrate",
        "has_kudoed",
        "hide_from_home",
        "kudos_count",
        "manual",
        "map",
        "max_speed",
        "photo_count",
        "photos",
        "pr_count",
        "private",
        "total_photo_count",
        "trainer",
    )

    # Fields to exclude when inserting SummaryActivity (not in BQ schema)
    _SUMMARY_FIELDS_TO_EXCLUDE: frozenset[str] = frozenset(
        {
            "resource_state",  # Conflicts with athlete.resource_state
            "location_city",
            "location_state",
            "location_country",
            "from_accepted_tag",
            "utc_offset",
        }
    )

    def __init__(
        self,
        client: BigQueryClientWrapper,
        *,
        dataset_name: str,
        table_name: str = "activities",
    ):
        self._client = client
        self._dataset_name = dataset_name
        self._table_name = table_name
        # Derive from main table name
        self._staging_table_name = f"{table_name}_staging"

    def write_activity(self, activity: DetailedStravaActivity) -> MergeResult:
        """Two-step upsert: stage then merge.

        Returns:
            MergeResult with rows_affected, execution_time_ms, job_id, query_preview
        """
        # Step 1: Insert to staging table (fast streaming insert)
        self._write_to_staging(activity)

        # Step 2: MERGE from staging to main table
        return self._merge_from_staging(activity.id)

    def write_activities_batch(
        self, activities: list[DetailedStravaActivity | SummaryStravaActivity]
    ) -> MergeResult:
        """Batch upsert: stage all activities, then merge all at once.

        Args:
            activities: List of activities to insert (DetailedActivity or SummaryActivity)

        Returns:
            MergeResult with rows_affected, execution_time_ms, job_id, query_preview

        Raises:
            ValueError: If batch size exceeds BigQuery's 10,000 row limit

        Note:
            - BigQuery supports up to 10,000 rows per insert_rows_json call
            - For larger batches, chunk them before calling this method
            - Much faster than individual inserts (1 API call vs N calls)
            - Accepts both DetailedActivity and SummaryActivity models
            - Missing fields in SummaryActivity will be NULL in BigQuery
        """
        if not activities:
            return MergeResult(
                rows_affected=0,
                execution_time_ms=0,
                job_id="",
                query_preview="(empty batch)",
            )

        if len(activities) > self._MAX_BATCH_SIZE:
            raise ValueError(
                f"Batch size {len(activities)} exceeds BigQuery streaming insert "
                f"limit of {self._MAX_BATCH_SIZE} rows. Chunk your data before calling "
                f"write_activities_batch()."
            )

        # Step 1: Insert all to staging table (single API call)
        self._write_batch_to_staging(activities)

        # Step 2: MERGE all from staging to main table
        activity_ids = [activity.id for activity in activities]
        return self._merge_batch_from_staging(activity_ids)

    def _write_to_staging(self, activity: DetailedStravaActivity) -> None:
        """Insert activity to staging table using fast streaming insert"""
        activities_dict = [activity.model_dump(mode="json")]
        self._client.insert_rows_json(
            activities_dict,
            dataset_name=self._dataset_name,
            table_name=self._staging_table_name,
        )

    def _write_batch_to_staging(
        self, activities: list[DetailedStravaActivity | SummaryStravaActivity]
    ) -> None:
        """Insert multiple activities to staging table in one API call

        Accepts both DetailedActivity and SummaryActivity models.

        For SummaryActivity, excludes fields not in BigQuery schema:
        - resource_state (top-level, conflicts with nested athlete.resource_state)
        - location_city/state/country (not in schema)
        - from_accepted_tag (not in schema)
        - utc_offset (not in schema, we have timezone)
        - calories when None (BigQuery rejects empty numeric fields)
        """
        activities_dict = []
        for activity in activities:
            data = activity.model_dump(mode="json")

            # If this is a SummaryActivity, remove fields not in BQ schema
            if isinstance(activity, SummaryStravaActivity):
                for field in self._SUMMARY_FIELDS_TO_EXCLUDE:
                    data.pop(field, None)

            activities_dict.append(data)

        self._client.insert_rows_json(
            activities_dict,
            dataset_name=self._dataset_name,
            table_name=self._staging_table_name,
        )

    def _merge_from_staging(self, activity_id: int) -> MergeResult:
        """Execute MERGE operation from staging to main table for specific activity"""
        merge_query, query_params = self._build_merge_query(activity_id)
        result = self._client.execute_merge_query(merge_query, query_params)
        # Clean up staging table after successful merge
        self._cleanup_staging([activity_id])
        return result

    def _merge_batch_from_staging(self, activity_ids: list[int]) -> MergeResult:
        """Execute MERGE operation for multiple activities at once"""
        merge_query, query_params = self._build_batch_merge_query(activity_ids)
        result = self._client.execute_merge_query(merge_query, query_params)
        # Clean up staging table after successful merge
        self._cleanup_staging(activity_ids)
        return result

    def _cleanup_staging(self, activity_ids: list[int]) -> None:
        """Delete merged rows from staging table.

        Called after successful MERGE to prevent staging table from growing indefinitely.
        Uses parameterized query to prevent SQL injection.

        If rows are still in BigQuery's streaming buffer (up to ~90 minutes after
        insert), the DELETE will fail. This is safe to ignore — the MERGE is
        idempotent, so stale staging rows only cause redundant no-op merges.
        """
        delete_query = f"""
        DELETE FROM `{self._client.project_id}.{self._dataset_name}.{self._staging_table_name}`
        WHERE id IN UNNEST(@activity_ids)
        """
        query_params = [ArrayQueryParameter("activity_ids", "INT64", activity_ids)]
        try:
            self._client.execute_dml_query(delete_query, query_params)
        except BigQueryError as e:
            if isinstance(e.__cause__, BadRequest):
                logger.warning(
                    "Staging cleanup skipped — rows still in streaming buffer",
                    extra={"activity_ids": activity_ids},
                )
            else:
                raise

    def _build_merge_query(
        self, activity_id: int
    ) -> tuple[str, list[ScalarQueryParameter]]:
        """Build MERGE query for single activity upsert operation.

        Uses parameterized queries to prevent SQL injection.

        Returns:
            Tuple of (query_string, query_parameters)
        """
        where_clause = "id = @activity_id"
        query_params = [ScalarQueryParameter("activity_id", "INT64", activity_id)]
        return self._build_merge_query_base(where_clause), query_params

    def _build_batch_merge_query(
        self, activity_ids: list[int]
    ) -> tuple[str, list[ArrayQueryParameter]]:
        """Build MERGE query for batch upsert operation.

        Uses parameterized queries to prevent SQL injection.

        Returns:
            Tuple of (query_string, query_parameters)
        """
        where_clause = "id IN UNNEST(@activity_ids)"
        query_params = [ArrayQueryParameter("activity_ids", "INT64", activity_ids)]
        return self._build_merge_query_base(where_clause), query_params

    def _build_merge_query_base(self, where_clause: str) -> str:
        """Build MERGE query with parameterized WHERE clause.

        Args:
            where_clause: SQL WHERE condition for staging table filter
                          (e.g., "id = 123" or "id IN (1,2,3)")

        Returns:
            Complete MERGE SQL query string
        """
        # Build UPDATE SET clause: "col = source.col, ..."
        update_set = ",\n                ".join(
            f"{col} = source.{col}" for col in self._MERGE_COLUMNS
        )

        # Build INSERT columns: "id, col1, col2, ..."
        insert_cols = "id, " + ", ".join(self._MERGE_COLUMNS)

        # Build VALUES: "source.id, source.col1, source.col2, ..."
        insert_vals = "source.id, " + ", ".join(
            f"source.{col}" for col in self._MERGE_COLUMNS
        )

        # Build explicit SELECT columns for source query (avoids SELECT * EXCEPT fragility)
        select_cols = "id, " + ", ".join(self._MERGE_COLUMNS)

        return f"""
        MERGE `{self._client.project_id}.{self._dataset_name}.{self._table_name}` AS target
        USING (
            SELECT {select_cols} FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY start_date DESC) as row_num
                FROM `{self._client.project_id}.{self._dataset_name}.{self._staging_table_name}`
                WHERE {where_clause}
            ) WHERE row_num = 1
        ) AS source
        ON target.id = source.id
        WHEN MATCHED THEN
            UPDATE SET
                {update_set}
        WHEN NOT MATCHED THEN
            INSERT ({insert_cols})
            VALUES ({insert_vals})
        """

    def read_activity_metadata(self, activity_id: int) -> MinimalStravaActivity:
        """Query BigQuery for minimal activity metadata by ID.

        Checks both 'activities' and 'deleted_activities' tables using UNION
        to handle race condition where activity may have been moved to
        deleted_activities before this query runs.

        Args:
            activity_id: Strava activity ID to look up

        Returns:
            MinimalStravaActivity with id, type, start_date_local, distance

        Raises:
            ActivityNotFoundError: If activity not found in either table
        """
        query = f"""
        SELECT
            id,
            type,
            start_date_local,
            distance,
            moving_time,
            total_elevation_gain
        FROM (
            -- Check active activities table
            SELECT id, type, start_date_local, distance, moving_time, total_elevation_gain
            FROM `{self._client.project_id}.{self._dataset_name}.{self._table_name}`
            WHERE id = @activity_id

            UNION ALL

            -- Also check deleted activities (handles race condition)
            SELECT id, type, start_date_local, distance, moving_time, total_elevation_gain
            FROM `{self._client.project_id}.{self._dataset_name}.deleted_activities`
            WHERE id = @activity_id
        )
        LIMIT 1
        """

        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("activity_id", "INT64", activity_id)
            ]
        )

        result = self._client._client.query(query, job_config=job_config).result()
        rows = list(result)

        if not rows:
            raise ActivityNotFoundError(
                activity_id,
                f"Activity {activity_id} not found in BigQuery "
                "(checked both activities and deleted_activities tables)",
            )

        row = rows[0]

        # MinimalStravaActivity expects all fields in meters/seconds
        return MinimalStravaActivity(
            id=row.id,
            type=row.type,
            start_date_local=row.start_date_local,
            distance=row.distance,  # meters from BigQuery
            moving_time=row.moving_time,  # seconds from BigQuery
            total_elevation_gain=row.total_elevation_gain,  # meters from BigQuery
        )
