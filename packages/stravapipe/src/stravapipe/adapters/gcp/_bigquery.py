"""BigQuery adapters for reading and writing Strava activities."""

from google.cloud.bigquery import ArrayQueryParameter, ScalarQueryParameter
from opentelemetry.metrics import Histogram
from opentelemetry.trace import Tracer

from stravapipe.adapters.gcp._bigquery_storage import BigQueryStorageWriter
from stravapipe.adapters.gcp._clients import BigQueryClientWrapper, MergeResult
from stravapipe.domain import (
    DetailedStravaActivity,
    SummaryStravaActivity,
)
from stravapipe.ports.out.write import WriteActivities
from stravapipe.shared.metrics import record_duration
from stravapipe.shared.tracing import db_attributes, record_span


class ActivitiesWriter(WriteActivities):
    """Write Strava Activities to BigQuery via staging table + MERGE."""

    # Application-level sanity ceiling. The real Storage Write API cap is
    # 10 MB per AppendRowsRequest (bytes-based), enforced at the gRPC
    # layer; this row-count guard is just a smoke alarm against runaway
    # in-memory lists. Backfill chunks at 100 by default — orders of
    # magnitude below either limit.
    # https://cloud.google.com/bigquery/quotas#write-api-limits
    _MAX_BATCH_SIZE: int = 10_000

    # Column definitions for MERGE queries (single source of truth).
    # Every column that can be updated/inserted, excluding 'id' (the key).
    #
    # This must stay in parity with the BQ schema (schemas/bigquery/
    # activities_full.json, via the generated proto descriptor) — a column
    # missing here lands NULL in `activities` no matter what staging holds,
    # because the MERGE only propagates what this tuple names.
    # test_merge_columns_match_proto_descriptor enforces the parity; keep the
    # order aligned with the proto so the two read side by side.
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
        "start_latlng",
        "end_latlng",
        "achievement_count",
        "kudos_count",
        "comment_count",
        "athlete_count",
        "photo_count",
        "total_photo_count",
        "map",
        "trainer",
        "commute",
        "manual",
        "private",
        "flagged",
        "workout_type",
        "upload_id_str",
        "average_speed",
        "max_speed",
        "has_kudoed",
        "hide_from_home",
        "gear_id",
        "kilojoules",
        "average_watts",
        "device_watts",
        "max_watts",
        "weighted_average_watts",
        "description",
        "photos",
        "gear",
        "calories",
        "segment_efforts",
        "device_name",
        "embed_token",
        "splits_metric",
        "splits_standard",
        "laps",
        "best_efforts",
        "average_cadence",
        "has_heartrate",
        "pr_count",
        "suffer_score",
        "stats_visibility",
        "display_hide_heartrate_option",
        "heartrate_opt_out",
        "average_heartrate",
        "max_heartrate",
        "available_zones",
        "visibility",
    )

    def __init__(
        self,
        client: BigQueryClientWrapper,
        storage_writer: BigQueryStorageWriter,
        *,
        dataset_name: str,
        table_name: str = "activities",
        tracer: Tracer | None = None,
        histogram: Histogram | None = None,
    ):
        self._client = client
        self._storage_writer = storage_writer
        self._dataset_name = dataset_name
        self._table_name = table_name
        # Derive from main table name
        self._staging_table_name = f"{table_name}_staging"
        # Both optional so non-service callers (e.g. the backfill job) can
        # leave them unset; record_span/record_duration no-op when None.
        self._tracer = tracer
        # The histogram, when set, captures sub-operation duration on the
        # same `desirelines.io/bigquery/operation.duration` metric the outer
        # `bigquery.insert_rows` already uses, with operation labels matching
        # the span names. Lets the SLO task attach burn-rate alerts to e.g.
        # the MERGE step independently of write_to_staging.
        self._histogram = histogram

    def write_activity(self, activity: DetailedStravaActivity) -> MergeResult:
        """Two-step upsert: stage then merge.

        Returns:
            MergeResult with rows_affected, execution_time_ms, job_id, query_preview
        """
        # Step 1: Insert to staging table (fast streaming insert)
        self._write_to_staging(activity)

        # Step 2: MERGE from staging to main table
        return self._merge_from_staging(activity.id)

    def close(self) -> None:
        """Release adapter-owned resources.

        Closes the underlying Storage Write API stream. Idempotent;
        callers (Cloud Run lifespan, backfill teardown) should invoke
        once on shutdown.
        """
        self._storage_writer.close()

    def write_activities_batch(
        self, activities: list[DetailedStravaActivity | SummaryStravaActivity]
    ) -> MergeResult:
        """Batch upsert: stage all activities, then merge all at once.

        Args:
            activities: List of activities to insert (DetailedActivity or SummaryActivity)

        Returns:
            MergeResult with rows_affected, execution_time_ms, job_id, query_preview

        Raises:
            ValueError: If batch size exceeds the application-level
                sanity cap (``_MAX_BATCH_SIZE``).

        Note:
            - All writes go through the Storage Write API; the real cap
              is 10 MB per AppendRowsRequest (bytes-based, not rows).
            - Backfill chunks at 100 by default — well below both caps.
            - Much faster than individual inserts (1 API call vs N calls).
            - Accepts both DetailedActivity and SummaryActivity models.
            - Missing fields in SummaryActivity will be NULL in BigQuery.
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
                f"Batch size {len(activities)} exceeds the sanity cap of "
                f"{self._MAX_BATCH_SIZE} rows. Chunk your data before calling "
                f"write_activities_batch()."
            )

        # Step 1: Insert all to staging table (single API call)
        self._write_batch_to_staging(activities)

        # Step 2: MERGE all from staging to main table
        activity_ids = [activity.id for activity in activities]
        return self._merge_batch_from_staging(activity_ids)

    def _write_to_staging(self, activity: DetailedStravaActivity) -> None:
        """Write activity to staging via the BigQuery Storage Write API.

        Committed-mode rows are immediately consistent — they're not held
        in the legacy streaming buffer — so the post-MERGE DELETE in
        ``_cleanup_staging`` runs without retries.
        """
        with (
            record_span(
                self._tracer,
                "bigquery.write_to_staging",
                db_attributes(
                    "bigquery",
                    self._dataset_name,
                    "INSERT",
                    {"desirelines.activity_id": activity.id},
                ),
            ),
            record_duration(self._histogram, {"operation": "write_to_staging"}),
        ):
            self._storage_writer.write_activity(activity)

    def _write_batch_to_staging(
        self, activities: list[DetailedStravaActivity | SummaryStravaActivity]
    ) -> None:
        """Insert multiple activities to staging via the Storage Write API.

        Delegates to ``BigQueryStorageWriter`` (same wrapper the
        single-activity path uses). Accepts both DetailedActivity and
        SummaryActivity — the wrapper picks the right dump method per
        instance.
        """
        with (
            record_span(
                self._tracer,
                "bigquery.write_batch_to_staging",
                db_attributes(
                    "bigquery",
                    self._dataset_name,
                    "INSERT",
                    {"batch_size": len(activities)},
                ),
            ),
            record_duration(self._histogram, {"operation": "write_batch_to_staging"}),
        ):
            self._storage_writer.write_activities_batch(activities)

    def _merge_from_staging(self, activity_id: int) -> MergeResult:
        """Execute MERGE operation from staging to main table for specific activity.

        Sub-spans (``bigquery.merge_from_staging`` and ``bigquery.cleanup_staging``)
        let traces show MERGE-vs-DELETE latency separately — the CDC migration
        decision depends on this split.
        """
        merge_query, query_params = self._build_merge_query(activity_id)
        with (
            record_span(
                self._tracer,
                "bigquery.merge_from_staging",
                db_attributes(
                    "bigquery",
                    self._dataset_name,
                    "MERGE",
                    {"desirelines.activity_id": activity_id},
                ),
            ),
            record_duration(self._histogram, {"operation": "merge_from_staging"}),
        ):
            result = self._client.execute_merge_query(merge_query, query_params)
        # Clean up staging table after successful merge
        self._cleanup_staging([activity_id])
        return result

    def _merge_batch_from_staging(self, activity_ids: list[int]) -> MergeResult:
        """Execute MERGE operation for multiple activities at once"""
        merge_query, query_params = self._build_batch_merge_query(activity_ids)
        with (
            record_span(
                self._tracer,
                "bigquery.merge_batch_from_staging",
                db_attributes(
                    "bigquery",
                    self._dataset_name,
                    "MERGE",
                    {"batch_size": len(activity_ids)},
                ),
            ),
            record_duration(self._histogram, {"operation": "merge_batch_from_staging"}),
        ):
            result = self._client.execute_merge_query(merge_query, query_params)
        # Clean up staging table after successful merge
        self._cleanup_staging(activity_ids)
        return result

    def _cleanup_staging(self, activity_ids: list[int]) -> None:
        """Delete merged rows from staging table.

        Called after successful MERGE to prevent staging table from growing
        indefinitely. All writes go through the Storage Write API
        (committed-mode, immediately consistent), so this DELETE has no
        streaming-buffer race to defend against.
        """
        delete_query = f"""
        DELETE FROM `{self._client.project_id}.{self._dataset_name}.{self._staging_table_name}`
        WHERE id IN UNNEST(@activity_ids)
        """
        query_params = [ArrayQueryParameter("activity_ids", "INT64", activity_ids)]
        with record_span(
            self._tracer,
            "bigquery.cleanup_staging",
            db_attributes(
                "bigquery",
                self._dataset_name,
                "DELETE",
                {"batch_size": len(activity_ids)},
            ),
        ):
            self._client.execute_dml_query(delete_query, query_params)

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
