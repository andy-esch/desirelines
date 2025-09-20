from collections.abc import Callable
import logging

from stravabqsync.adapters import Supplier
from stravabqsync.domain import StravaTokenSet
from stravabqsync.ports.out.read import ReadActivities, ReadStravaToken
from stravabqsync.ports.out.write import WriteActivities

logger = logging.getLogger(__name__)


class SyncService:
    """Receive Webhook message, parse and fetch related activity, and write
    activity to BigQuery"""

    def __init__(
        self,
        read_strava_token: Supplier[ReadStravaToken],
        read_activities: Callable[[StravaTokenSet], ReadActivities],
        write_activities: Supplier[WriteActivities],
        enable_upsert: bool = False,
    ):
        """Initialize the sync service with required dependencies.

        Args:
            read_strava_token: Factory function for token refresh service.
            read_activities: Factory function for activity reading service.
            write_activities: Factory function for activity writing service.
            enable_upsert: Whether to use upsert logic for duplicate handling.

        Raises:
            StravaTokenError: If initial token refresh fails.
            StravaApiError: If token refresh API call fails.
        """
        self._tokens = read_strava_token().refresh()
        self._read_activities = read_activities(self._tokens)
        self._write_activities = write_activities()
        self._enable_upsert = enable_upsert

    def run(self, activity_id: int) -> None:
        """Sync data for `activity_id` from Strava to BigQuery activities table"""
        activity = self._read_activities.read_activity_by_id(activity_id)

        if self._enable_upsert:
            # Use upsert method for data integrity
            stats = self._write_activities.write_activity_with_upsert(activity)
            logger.info(
                "Activity upserted successfully",
                extra={
                    "activity_id": activity_id,
                    "operation": "upsert",
                    "rows_affected": stats.get("rows_affected", 0),
                    "execution_time_ms": stats.get("execution_time_ms"),
                }
            )
        else:
            # Use legacy insert method
            self._write_activities.write_activity(activity)
            logger.info(
                "Activity inserted successfully",
                extra={
                    "activity_id": activity_id,
                    "operation": "insert",
                }
            )
