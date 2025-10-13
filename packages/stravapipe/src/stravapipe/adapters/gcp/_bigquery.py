"""BigQuery adapter for reading and writing Strava activities."""

from google.cloud import bigquery

from stravapipe.adapters.gcp._clients import BigQueryClientWrapper
from stravapipe.domain import DetailedStravaActivity, MinimalStravaActivity
from stravapipe.exceptions import ActivityNotFoundError
from stravapipe.ports.out.read import ReadActivitiesMetadata
from stravapipe.ports.out.write import WriteActivities


class ActivitiesRepo(WriteActivities, ReadActivitiesMetadata):
    """Read and write Strava Activities to/from BigQuery"""

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

    def write_activity(self, activity: DetailedStravaActivity) -> dict:
        """Two-step upsert: stage then merge

        Returns:
            dict: Statistics from the MERGE operation
        """
        # Step 1: Insert to staging table (fast streaming insert)
        self._write_to_staging(activity)

        # Step 2: MERGE from staging to main table
        return self._merge_from_staging(activity.id)

    def _write_to_staging(self, activity: DetailedStravaActivity) -> None:
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
                external_id = source.external_id,
                upload_id = source.upload_id,
                athlete = source.athlete,
                name = source.name,
                distance = source.distance,
                moving_time = source.moving_time,
                elapsed_time = source.elapsed_time,
                total_elevation_gain = source.total_elevation_gain,
                elev_high = source.elev_high,
                elev_low = source.elev_low,
                type = source.type,
                sport_type = source.sport_type,
                start_date = source.start_date,
                start_date_local = source.start_date_local,
                timezone = source.timezone,
                achievement_count = source.achievement_count,
                athlete_count = source.athlete_count,
                average_speed = source.average_speed,
                calories = source.calories,
                comment_count = source.comment_count,
                commute = source.commute,
                embed_token = source.embed_token,
                flagged = source.flagged,
                has_heartrate = source.has_heartrate,
                has_kudoed = source.has_kudoed,
                hide_from_home = source.hide_from_home,
                kudos_count = source.kudos_count,
                manual = source.manual,
                map = source.map,
                max_speed = source.max_speed,
                photo_count = source.photo_count,
                photos = source.photos,
                pr_count = source.pr_count,
                private = source.private,
                total_photo_count = source.total_photo_count,
                trainer = source.trainer
        WHEN NOT MATCHED THEN
            INSERT (
                id, external_id, upload_id, athlete, name, distance, moving_time,
                elapsed_time, total_elevation_gain, elev_high, elev_low, type,
                sport_type, start_date, start_date_local, timezone,
                achievement_count, athlete_count, average_speed, calories,
                comment_count, commute, embed_token, flagged, has_heartrate,
                has_kudoed, hide_from_home, kudos_count, manual, map,
                max_speed, photo_count, photos, pr_count, private,
                total_photo_count, trainer
            )
            VALUES (
                source.id, source.external_id, source.upload_id, source.athlete,
                source.name, source.distance, source.moving_time, source.elapsed_time,
                source.total_elevation_gain, source.elev_high, source.elev_low,
                source.type, source.sport_type, source.start_date, source.start_date_local,
                source.timezone, source.achievement_count, source.athlete_count,
                source.average_speed, source.calories, source.comment_count,
                source.commute, source.embed_token, source.flagged,
                source.has_heartrate, source.has_kudoed, source.hide_from_home,
                source.kudos_count, source.manual, source.map, source.max_speed,
                source.photo_count, source.photos, source.pr_count, source.private,
                source.total_photo_count, source.trainer
            )
        """

    def read_activity_metadata(self, activity_id: int) -> MinimalStravaActivity:
        """Query BigQuery for minimal activity metadata by ID.

        Checks both 'activities' and 'deleted_activities' tables using UNION
        to handle race condition where BQ inserter may have already moved
        the activity before aggregator queries for it.

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
            distance
        FROM (
            -- Check active activities table
            SELECT id, type, start_date_local, distance
            FROM `{self._client.project_id}.{self._dataset_name}.{self._table_name}`
            WHERE id = @activity_id

            UNION ALL

            -- Also check deleted activities (handles race condition)
            SELECT id, type, start_date_local, distance
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

        # Convert distance from meters to miles for MinimalStravaActivity
        distance_miles = row.distance / 1000.0 * 0.62137

        return MinimalStravaActivity(
            id=row.id,
            type=row.type,
            start_date_local=row.start_date_local,
            distance=distance_miles,  # Already converted to miles
        )
