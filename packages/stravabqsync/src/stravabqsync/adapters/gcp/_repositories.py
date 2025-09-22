from stravabqsync.adapters.gcp._clients import BigQueryClientWrapper
from stravabqsync.domain import StravaActivity
from stravabqsync.ports.out.write import WriteActivities


class WriteActivitiesRepo(WriteActivities):
    """Write Strava Activities to BigQuery"""

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

    def write_activity(self, activity: StravaActivity) -> dict:
        """Two-step upsert: stage then merge

        Returns:
            dict: Statistics from the MERGE operation
        """
        # Step 1: Insert to staging table (fast streaming insert)
        self._write_to_staging(activity)

        # Step 2: MERGE from staging to main table
        return self._merge_from_staging(activity.id)

    def _write_to_staging(self, activity: StravaActivity) -> None:
        """Insert activity to staging table using fast streaming insert"""
        activities_dict = [activity.model_dump(mode="json")]
        self._client.insert_rows_json(
            activities_dict,
            dataset_name=self._dataset_name,
            table_name=self._staging_table_name,
        )

    def _merge_from_staging(self, activity_id: int) -> dict:
        """Execute MERGE operation from staging to main table for specific activity"""
        merge_query = self._build_merge_query(activity_id)
        return self._client.execute_merge_query(merge_query)

    def _build_merge_query(self, activity_id: int) -> str:
        """Build MERGE query for upsert operation"""
        return f"""
        MERGE `{self._client.project_id}.{self._dataset_name}.{self._table_name}` AS target
        USING (
            SELECT * EXCEPT(row_num) FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY start_date DESC) as row_num
                FROM `{self._client.project_id}.{self._dataset_name}.{self._staging_table_name}`
                WHERE id = {activity_id}
            ) WHERE row_num = 1
        ) AS source
        ON target.id = source.id
        WHEN MATCHED THEN
            UPDATE SET
                name = source.name,
                distance = source.distance,
                moving_time = source.moving_time,
                total_elevation_gain = source.total_elevation_gain,
                type = source.type,
                start_date = source.start_date,
                updated_at = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN
            INSERT (
                id, name, distance, moving_time,
                total_elevation_gain, type, start_date,
                created_at, updated_at
            )
            VALUES (
                source.id, source.name, source.distance,
                source.moving_time, source.total_elevation_gain,
                source.type, source.start_date,
                CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
            )
        """
