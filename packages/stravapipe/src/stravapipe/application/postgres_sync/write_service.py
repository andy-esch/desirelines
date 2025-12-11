"""PostgreSQL write service for syncing Strava activities.

This service coordinates reading from Strava API and writing to PostgreSQL
using the Unit of Work pattern for transaction management.
"""

import logging

from stravapipe.domain import StandardActivity
from stravapipe.ports.out.read import ReadDetailedActivities
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

    def __init__(
        self,
        uow: AbstractUnitOfWork,
        strava_reader: ReadDetailedActivities,
    ):
        """Initialize service with dependencies.

        Args:
            uow: Unit of Work for PostgreSQL transactions
            strava_reader: Reader for fetching activities from Strava API
        """
        self._uow = uow
        self._strava_reader = strava_reader

    def sync_activity(self, activity_id: int) -> dict:
        """Sync a single activity from Strava to PostgreSQL.

        Fetches the activity from Strava API and upserts to PostgreSQL.

        Args:
            activity_id: Strava activity ID

        Returns:
            dict: Operation result with "inserted" or "updated" key
        """
        # Fetch from Strava API
        detailed_activity = self._strava_reader.read_activity_by_id(activity_id)

        # Parse to StandardActivity (only validates fields we care about)
        activity = StandardActivity.model_validate(detailed_activity.model_dump())

        # Write to PostgreSQL within transaction
        with self._uow:
            result = self._uow.activities.upsert(activity)
            self._uow.commit()

        operation = "inserted" if result.get("inserted") else "updated"
        logger.info(
            f"Activity {operation} successfully",
            extra={
                "activity_id": activity_id,
                "operation": operation,
                "user_id": activity.user_id,
            },
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
