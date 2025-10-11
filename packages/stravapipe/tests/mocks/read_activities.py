from stravapipe.domain import MinimalStravaActivity
from stravapipe.ports.out.read import ReadMinimalActivities


class MockReadActivities(ReadMinimalActivities):
    """Mock for minimal activities (aggregator tests)"""
    def __init__(self, activities: dict[int, MinimalStravaActivity]):
        self.activities = activities

    def read_activity_by_id(self, activity_id: int) -> MinimalStravaActivity:
        return self.activities.get(activity_id)

    def read_activities_by_year(self, year: int) -> list[MinimalStravaActivity]:
        pass
