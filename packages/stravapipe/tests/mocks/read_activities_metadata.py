"""Mock for BigQuery activities metadata reader"""

from stravapipe.domain import MinimalStravaActivity
from stravapipe.exceptions import ActivityNotFoundError
from stravapipe.ports.out.read import ReadActivitiesMetadata


class MockReadActivitiesMetadata(ReadActivitiesMetadata):
    """Mock for reading activity metadata from BigQuery (for delete operations)"""

    def __init__(self, activities: dict[int, MinimalStravaActivity]):
        self.activities = activities

    def read_activity_metadata(self, activity_id: int) -> MinimalStravaActivity:
        """Get activity metadata by ID

        Raises:
            ActivityNotFoundError: If activity not found (simulates BigQuery miss)
        """
        if activity_id not in self.activities:
            raise ActivityNotFoundError(
                activity_id,
                f"Activity {activity_id} not found in BigQuery "
                "(checked both activities and deleted_activities tables)",
            )
        return self.activities[activity_id]
