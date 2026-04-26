"""PostgreSQL write service for syncing Strava activities.

This service coordinates reading from Strava API and writing to PostgreSQL
using the Unit of Work pattern for transaction management. Events triggered
on webhook events received (create, update, delete).

Data written from this service into PostgreSQL will be read in the frontend
via API Gateway.
"""

import logging
from typing import Any

from stravapipe.ports.out.read import ReadStandardActivities
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork

logger = logging.getLogger(__name__)


class PostgresWriteService:
    """Service for writing Strava activities to PostgreSQL.

    Uses Unit of Work pattern for transaction management and
    dependency injection for testability.

    Usage:
        service = PostgresWriteService(
            uow=SqlAlchemyUnitOfWork(session_factory),
            strava_reader=StravaActivitiesRepo(token_refresher),
        )
        service.sync_activity(activity_id)
    """

    def __init__(self, uow: AbstractUnitOfWork, strava_reader: ReadStandardActivities):
        """Initialize service with dependencies.

        Args:
            uow: Unit of Work for PostgreSQL transactions
            strava_reader: Reader for fetching standard activities from Strava API
        """
        self._uow = uow
        self._strava_reader = strava_reader

    def create_activity(self, activity_id: int) -> bool:
        """Create a new activity in PostgreSQL.

        Fetches the activity from Strava API and inserts to PostgreSQL.
        Uses INSERT with ON CONFLICT DO NOTHING - duplicates log warning but don't fail.

        Args:
            activity_id: Strava activity ID

        Returns:
            True if inserted, False if already existed
        """
        # Fetch from Strava API
        activity = self._strava_reader.read_standard_activity_by_id(activity_id)

        # Insert to PostgreSQL within transaction
        with self._uow:
            inserted = self._uow.activities.insert(activity)
            self._uow.commit()

        if inserted:
            logger.info(
                "Activity created successfully",
                extra={
                    "activity_id": activity_id,
                    "user_id": activity.user_id,
                },
            )
        else:
            logger.warning(
                "Activity already exists (duplicate CREATE event)",
                extra={
                    "activity_id": activity_id,
                },
            )

        return inserted

    def activity_exists(self, activity_id: int) -> bool:
        """Check if activity exists in PostgreSQL.

        Used by UPDATE handler to determine if we need to fetch from Strava
        (for activities that predate our PostgreSQL setup).

        Args:
            activity_id: Strava activity ID

        Returns:
            True if exists, False otherwise
        """
        with self._uow:
            return self._uow.activities.exists(activity_id)

    def update_activity_metadata(
        self, activity_id: int, updates: dict[str, Any]
    ) -> bool | None:
        """Update only metadata fields from UPDATE webhook.

        Does NOT fetch from Strava API - uses updates hash directly.
        Only updates fields that changed (title → name, type → type/sport).

        Args:
            activity_id: Strava activity ID
            updates: Dict from webhook with 'title' and/or 'type' keys

        Returns:
            True if updated successfully
            False if activity not found
            None if no valid updates provided
        """
        with self._uow:
            result = self._uow.activities.update_metadata(activity_id, updates)
            self._uow.commit()

        if result is True:
            logger.info(
                "Activity metadata updated",
                extra={"activity_id": activity_id, "updates": updates},
            )
        elif result is False:
            logger.warning(
                "Activity not found for metadata update",
                extra={"activity_id": activity_id},
            )
        else:  # None - no valid updates
            logger.debug(
                "No valid updates to apply",
                extra={"activity_id": activity_id, "updates": updates},
            )

        return result

    def delete_activity(self, activity_id: int) -> bool:
        """Delete an activity from PostgreSQL.

        Args:
            activity_id: Strava activity ID

        Returns:
            True if deleted, False if not found
        """
        with self._uow:
            deleted = self._uow.activities.delete(activity_id)
            self._uow.commit()

        if deleted:
            logger.info(
                "Activity deleted successfully",
                extra={"activity_id": activity_id},
            )
        else:
            logger.warning(
                "Activity not found for deletion",
                extra={"activity_id": activity_id},
            )

        return deleted
