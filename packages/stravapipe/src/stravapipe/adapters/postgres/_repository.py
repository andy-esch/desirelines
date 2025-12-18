"""SQLAlchemy repository for PostgreSQL activity storage.

Uses raw SQL via sa.text() for simple, efficient queries.
Repository receives Session from Unit of Work - doesn't manage its own connection.
"""

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from stravapipe.domain import StandardActivity
from stravapipe.ports.out.postgres import ActivityRepository


class SqlAlchemyActivityRepository(ActivityRepository):
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

    def insert(self, activity: StandardActivity) -> bool:
        """Insert activity, ignore if already exists.

        Uses ON CONFLICT DO NOTHING - duplicates are not errors.

        Args:
            activity: StandardActivity domain model

        Returns:
            True if inserted, False if already existed (conflict)
        """
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
            ON CONFLICT (id) DO NOTHING
            RETURNING id
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
        # RETURNING id only returns a row if insert happened (not on conflict)
        return result.fetchone() is not None

    def exists(self, activity_id: int) -> bool:
        """Check if activity exists in database.

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

    def update_metadata(self, activity_id: int, updates: dict) -> bool:
        """Update only metadata fields (name, type, sport).

        Builds dynamic UPDATE query based on which fields changed.

        Args:
            activity_id: Strava activity ID
            updates: Dict with optional keys: 'title', 'type'

        Returns:
            True if updated, False if activity not found
        """
        set_clauses = []
        params: dict = {"activity_id": activity_id}

        if "title" in updates:
            set_clauses.append("name = :name")
            params["name"] = updates["title"]

        if "type" in updates:
            # Strava webhooks send 'type' (base type like "Ride") not 'sport_type'
            # (specific type like "MountainBikeRide"). While lossy, updating both
            # columns is better than leaving stale data - "Ride" is more correct
            # than "Run" if the user changed their activity type.
            set_clauses.append("type = :type")
            set_clauses.append("sport = :sport")
            params["type"] = updates["type"]
            params["sport"] = updates["type"]

        if not set_clauses:
            return False  # Nothing to update

        set_clauses.append("updated_at = :updated_at")
        params["updated_at"] = datetime.now(UTC)

        query = text(f"""
            UPDATE desirelines.activities
            SET {", ".join(set_clauses)}
            WHERE id = :activity_id
            RETURNING id
        """)

        result = self._session.execute(query, params)
        return result.fetchone() is not None

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
