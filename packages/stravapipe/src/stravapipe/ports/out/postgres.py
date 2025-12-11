"""PostgreSQL repository ports for activity data.

These ports define the contract for PostgreSQL-backed repositories.
They are separate from BigQuery ports because:
- PostgreSQL receives filtered data (StandardActivity, not DetailedStravaActivity)
- PostgreSQL repositories are session-based (receive session from Unit of Work)
- Different query patterns and capabilities
"""

from abc import ABC, abstractmethod

from stravapipe.domain import StandardActivity


class WriteStandardActivities(ABC):
    """Write standard activities to PostgreSQL.

    This port is used with the Unit of Work pattern - implementations
    receive their database session from the UoW, not from __init__.
    """

    @abstractmethod
    def upsert(self, activity: StandardActivity) -> dict:
        """Upsert activity to PostgreSQL (insert or update on conflict).

        Args:
            activity: StandardActivity domain model

        Returns:
            dict: Operation metadata (e.g., {"inserted": True} or {"updated": True})
        """
        raise NotImplementedError

    @abstractmethod
    def delete(self, activity_id: int) -> bool:
        """Delete activity by ID.

        Args:
            activity_id: Strava activity ID

        Returns:
            True if deleted, False if not found
        """
        raise NotImplementedError


class ReadStandardActivities(ABC):
    """Read standard activities from PostgreSQL.

    This port is used with the Unit of Work pattern - implementations
    receive their database session from the UoW, not from __init__.
    """

    @abstractmethod
    def get_by_id(self, activity_id: int) -> StandardActivity | None:
        """Get activity by ID.

        Args:
            activity_id: Strava activity ID

        Returns:
            StandardActivity if found, None otherwise
        """
        raise NotImplementedError

    @abstractmethod
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
        raise NotImplementedError

    @abstractmethod
    def exists(self, activity_id: int) -> bool:
        """Check if activity exists.

        Args:
            activity_id: Strava activity ID

        Returns:
            True if exists, False otherwise
        """
        raise NotImplementedError
