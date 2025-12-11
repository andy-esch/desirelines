"""SQLAlchemy repository for PostgreSQL activity storage.

Uses raw SQL via sa.text() for simple, efficient queries.
Repository receives Session from Unit of Work - doesn't manage its own connection.
"""

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from stravapipe.domain import StandardActivity
from stravapipe.ports.out.postgres import (
    ReadStandardActivities,
    WriteStandardActivities,
)


class SqlAlchemyActivityRepository(WriteStandardActivities, ReadStandardActivities):
    """PostgreSQL repository for StandardActivity using SQLAlchemy.

    This repository does NOT manage its own session/connection.
    It receives a Session from the Unit of Work pattern.

    Usage:
        with uow:
            uow.activities.upsert(activity)
            uow.commit()
    """

    def __init__(self, session: Session):
        """Initialize repository with an active session.

        Args:
            session: SQLAlchemy Session from Unit of Work
        """
        self._session = session

    def upsert(self, activity: StandardActivity) -> dict:
        """Upsert activity using PostgreSQL ON CONFLICT.

        Args:
            activity: StandardActivity domain model

        Returns:
            dict: {"inserted": True} or {"updated": True}
        """
        # PostgreSQL upsert with ON CONFLICT
        query = text("""
            INSERT INTO desirelines.activities (
                id, user_id, name, type, sport, start_date_local,
                distance, moving_time, elapsed_time, total_elevation_gain,
                average_speed, max_speed, average_heartrate, max_heartrate,
                year, created_at, updated_at
            ) VALUES (
                :id, :user_id, :name, :type, :sport, :start_date_local,
                :distance, :moving_time, :elapsed_time, :total_elevation_gain,
                :average_speed, :max_speed, :average_heartrate, :max_heartrate,
                :year, :created_at, :updated_at
            )
            ON CONFLICT (id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                name = EXCLUDED.name,
                type = EXCLUDED.type,
                sport = EXCLUDED.sport,
                start_date_local = EXCLUDED.start_date_local,
                distance = EXCLUDED.distance,
                moving_time = EXCLUDED.moving_time,
                elapsed_time = EXCLUDED.elapsed_time,
                total_elevation_gain = EXCLUDED.total_elevation_gain,
                average_speed = EXCLUDED.average_speed,
                max_speed = EXCLUDED.max_speed,
                average_heartrate = EXCLUDED.average_heartrate,
                max_heartrate = EXCLUDED.max_heartrate,
                year = EXCLUDED.year,
                updated_at = EXCLUDED.updated_at
            RETURNING (xmax = 0) AS inserted
        """)

        now = datetime.now(UTC)
        result = self._session.execute(
            query,
            {
                "id": activity.id,
                "user_id": activity.user_id,
                "name": activity.name,
                "type": activity.type,
                "sport": activity.sport,
                "start_date_local": activity.start_date_local,
                "distance": activity.distance,
                "moving_time": activity.moving_time,
                "elapsed_time": activity.elapsed_time,
                "total_elevation_gain": activity.total_elevation_gain,
                "average_speed": activity.average_speed,
                "max_speed": activity.max_speed,
                "average_heartrate": activity.average_heartrate,
                "max_heartrate": activity.max_heartrate,
                "year": activity.year,
                "created_at": now,
                "updated_at": now,
            },
        )
        row = result.fetchone()
        # xmax = 0 means INSERT, otherwise UPDATE
        return {"inserted": row[0]} if row else {"inserted": False}

    def delete(self, activity_id: int) -> bool:
        """Delete activity by ID.

        Args:
            activity_id: Strava activity ID

        Returns:
            True if deleted, False if not found
        """
        query = text("""
            DELETE FROM desirelines.activities
            WHERE id = :activity_id
            RETURNING id
        """)
        result = self._session.execute(query, {"activity_id": activity_id})
        return result.fetchone() is not None

    def get_by_id(self, activity_id: int) -> StandardActivity | None:
        """Get activity by ID.

        Args:
            activity_id: Strava activity ID

        Returns:
            StandardActivity if found, None otherwise
        """
        query = text("""
            SELECT
                id, user_id, name, type, sport, start_date_local,
                distance, moving_time, elapsed_time, total_elevation_gain,
                average_speed, max_speed, average_heartrate, max_heartrate, year
            FROM desirelines.activities
            WHERE id = :activity_id
        """)
        result = self._session.execute(query, {"activity_id": activity_id})
        row = result.fetchone()

        if row is None:
            return None

        return self._row_to_activity(row)

    def get_by_user_and_year(
        self, user_id: str, year: int
    ) -> list[StandardActivity]:
        """Get all activities for a user in a specific year.

        Args:
            user_id: User identifier (Strava athlete ID as string)
            year: Year to filter by

        Returns:
            List of StandardActivity domain models
        """
        query = text("""
            SELECT
                id, user_id, name, type, sport, start_date_local,
                distance, moving_time, elapsed_time, total_elevation_gain,
                average_speed, max_speed, average_heartrate, max_heartrate, year
            FROM desirelines.activities
            WHERE user_id = :user_id AND year = :year
            ORDER BY start_date_local DESC
        """)
        result = self._session.execute(query, {"user_id": user_id, "year": year})
        return [self._row_to_activity(row) for row in result.fetchall()]

    def exists(self, activity_id: int) -> bool:
        """Check if activity exists.

        Args:
            activity_id: Strava activity ID

        Returns:
            True if exists, False otherwise
        """
        query = text("""
            SELECT 1 FROM desirelines.activities WHERE id = :activity_id
        """)
        result = self._session.execute(query, {"activity_id": activity_id})
        return result.fetchone() is not None

    @staticmethod
    def _row_to_activity(row) -> StandardActivity:
        """Convert database row to StandardActivity.

        Note: When reading from DB, we reconstruct StandardActivity
        from stored columns. The computed fields (user_id, sport, year)
        are stored directly, so we create a minimal dict that will validate.
        """
        # StandardActivity expects athlete object, but we stored user_id directly
        # We reconstruct with a minimal athlete to satisfy the model
        from stravapipe.domain import MetaAthlete

        return StandardActivity(
            id=row.id,
            athlete=MetaAthlete(id=int(row.user_id), resource_state=1),
            name=row.name,
            type=row.type,
            sport_type=row.sport.replace("_", " ").title(),  # Reverse normalization
            start_date_local=row.start_date_local,
            distance=row.distance,
            moving_time=row.moving_time,
            elapsed_time=row.elapsed_time,
            total_elevation_gain=row.total_elevation_gain,
            average_speed=row.average_speed,
            max_speed=row.max_speed,
            average_heartrate=row.average_heartrate,
            max_heartrate=row.max_heartrate,
        )
