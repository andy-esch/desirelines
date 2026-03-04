"""PostgreSQL repository port for activity data.

Defines the contract for PostgreSQL-backed activity repository.
Only includes methods actually needed by the postgres_writer cloud function.

Error Handling Pattern:
    These methods return bool for "not found" scenarios instead of raising
    exceptions. This is intentional for webhook processing where:
    - Events can be duplicated (CREATE twice for same activity)
    - Events can arrive out of order (DELETE before CREATE)
    - Idempotency is preferred over strict error handling

    Compare to Strava adapters which raise ActivityNotFoundError on 404:
    - Strava 404 is unexpected (we only fetch when we expect it to exist)
    - Postgres "not found" is expected (activities predating our sync)
"""

from abc import ABC, abstractmethod

from stravapipe.domain import StandardActivity


class ActivityRepository(ABC):
    """Repository for PostgreSQL activity operations.

    This port is used with the Unit of Work pattern - implementations
    receive their database session from the UoW, not from __init__.

    Methods return bool for success/not-found to support idempotent webhook
    processing. Database errors still raise exceptions.
    """

    @abstractmethod
    def insert(self, activity: StandardActivity) -> bool:
        """Insert activity to PostgreSQL, ignore if already exists.

        Used for CREATE webhooks - writes all activity fields.
        Uses ON CONFLICT DO NOTHING - duplicates are logged but not errors.

        Args:
            activity: StandardActivity domain model

        Returns:
            True if inserted, False if already existed (conflict)
        """
        raise NotImplementedError

    @abstractmethod
    def exists(self, activity_id: int) -> bool:
        """Check if activity exists in database.

        Used by UPDATE handler to determine if activity needs to be
        fetched from Strava (for activities predating our PostgreSQL setup).

        Args:
            activity_id: Strava activity ID

        Returns:
            True if exists, False otherwise
        """
        raise NotImplementedError

    @abstractmethod
    def update_metadata(self, activity_id: int, updates: dict) -> bool | None:
        """Update only metadata fields (name, type, sport).

        Used for UPDATE webhooks - only updates changed fields.
        Does NOT require fetching from Strava API.

        Args:
            activity_id: Strava activity ID
            updates: Dict with optional keys: 'title', 'type'

        Returns:
            True if updated successfully
            False if activity not found
            None if no valid updates provided (empty dict or unrecognized keys)
        """
        raise NotImplementedError

    @abstractmethod
    def insert_route(self, activity_id: int, geojson: str) -> bool:
        """Insert activity route geometry, ignore if already exists.

        Uses ON CONFLICT DO NOTHING to match activity insert behavior.

        Args:
            activity_id: Strava activity ID (must exist in activities table)
            geojson: GeoJSON LineString string for ST_GeomFromGeoJSON()

        Returns:
            True if inserted, False if already existed (conflict)
        """
        raise NotImplementedError

    @abstractmethod
    def delete(self, activity_id: int) -> bool:
        """Delete activity by ID.

        Used for DELETE webhooks - hard delete.

        Args:
            activity_id: Strava activity ID

        Returns:
            True if deleted, False if not found
        """
        raise NotImplementedError

    @abstractmethod
    def delete_by_user(self, user_id: str) -> int:
        """Delete all activities for a user.

        Used for user deauthorization — hard delete of all user data.
        activity_routes are cascade-deleted via FK (ON DELETE CASCADE).

        Args:
            user_id: Strava athlete ID (string)

        Returns:
            Count of deleted activity rows
        """
        raise NotImplementedError
