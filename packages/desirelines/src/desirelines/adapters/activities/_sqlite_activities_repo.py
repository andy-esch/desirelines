import sqlite3

from desirelines.domain import StravaActivity, SummaryEntry, SummaryObject
from desirelines.ports.out.read import ReadLocalActivities
from desirelines.ports.out.write import WriteLocalActivities

from ._database_file_manager import DatabaseFileManager


class SqliteActivitiesRepo(ReadLocalActivities, WriteLocalActivities):
    def __init__(self, file_manager: DatabaseFileManager, year: int):
        self._file_manager = file_manager
        self._year = year
        self._file_path = file_manager.download_database(year)

    def _get_connection(self) -> sqlite3.Connection:
        """Get a new database connection with named row access"""
        connection = sqlite3.connect(self._file_path)
        connection.row_factory = sqlite3.Row  # Enable named column access
        return connection

    def save_to_storage(self) -> None:
        """Save database back to storage"""
        self._file_manager.upload_database(self._file_path, self._year)

    def create_activities(self) -> None:
        """Create activities table"""
        create_statement = """
            BEGIN;
            CREATE TABLE activities(
                id int,
                type text,
                distance_miles real,
                month int,
                day int,
                start_date_local str
            );
            CREATE UNIQUE INDEX activities_id_idx ON activities(id);
            COMMIT;
        """
        # TODO move cursor and commit stuff to a client wrapper
        with self._get_connection() as connection:
            cur = connection.cursor()
            cur.executescript(create_statement)

    def insert_activity(self, activity: StravaActivity) -> None:
        query = """
            INSERT INTO activities(
                id, type, distance_miles, month, day, start_date_local
            )
            VALUES(
                :id, :type, :distance_miles, :month, :day, :start_date_local
            )
            ON CONFLICT(id) DO NOTHING;
        """
        params = activity.model_dump(
            include={"id", "type", "distance_miles", "start_date_local"}
        )
        params.update(
            {
                "month": activity.start_date_local.month,
                "day": activity.start_date_local.day,
            }
        )

        with self._get_connection() as connection:
            cur = connection.cursor()
            cur.execute(query, params)

    def read_activity_summary(self, year: int) -> SummaryObject:
        query = """
            SELECT
                month,
                day,
                sum(distance_miles) OVER (ORDER BY month, day) AS distance_miles
              FROM activities
            GROUP BY 1, 2
            ORDER BY 1, 2
        """
        with self._get_connection() as connection:
            cur = connection.cursor()
            resp = cur.execute(query).fetchall()
        summary = {
            f"{year}-{row.month}-{row.day}": SummaryEntry(
                distance_miles=row.distance_miles, activity_ids=[]
            )
            for row in resp
        }
        return summary

    def read_activities(self) -> list[StravaActivity]:
        """Read activities from local storage"""
        # TODO: Implement this method
        raise NotImplementedError("read_activities not yet implemented")

    def write_activity(self, activity: StravaActivity) -> None:
        """Write activity to local storage"""
        self.insert_activity(activity)
