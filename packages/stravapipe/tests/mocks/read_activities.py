from stravapipe.domain import MinimalStravaActivity
from stravapipe.ports.out.read import ReadMinimalActivities


class MockReadActivities(ReadMinimalActivities):
    """Mock for minimal activities (aggregator tests)"""

    def __init__(self, activities: dict[int, MinimalStravaActivity]):
        self.activities = activities

    def read_activity_by_id(self, activity_id: int) -> MinimalStravaActivity:
        activity = self.activities.get(activity_id)
        if activity is None:
            raise KeyError(f"Activity {activity_id} not found in mock")
        return activity

    def read_activities_by_year(self, year: int) -> list[MinimalStravaActivity]:
        # Not used in current tests - return empty list
        return []
