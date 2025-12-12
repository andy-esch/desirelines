"""PostgreSQL repository port for activity data.

Defines the contract for PostgreSQL-backed activity repository.
Only includes methods actually needed by the postgres_writer cloud function.
"""

from abc import ABC, abstractmethod

from stravapipe.domain import StandardActivity


class ActivityRepository(ABC):
    """Repository for PostgreSQL activity operations.

    This port is used with the Unit of Work pattern - implementations
    receive their database session from the UoW, not from __init__.

    Methods:
    - upsert: Write full activity (CREATE webhook)
    - update_metadata: Update only name/type/sport (UPDATE webhook)
    - delete: Remove activity (DELETE webhook)
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
    def update_metadata(self, activity_id: int, updates: dict) -> bool:
        """Update only metadata fields (name, type, sport).

        Used for UPDATE webhooks - only updates changed fields.
        Does NOT require fetching from Strava API.

        Args:
            activity_id: Strava activity ID
            updates: Dict with optional keys: 'title', 'type'

        Returns:
            True if updated, False if activity not found
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
