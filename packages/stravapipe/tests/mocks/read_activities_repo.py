from stravapipe.domain import DetailedStravaActivity
from stravapipe.ports.out.read import ReadDetailedActivities


class MockReadActivitiesRepo(ReadDetailedActivities):
    """Mock for detailed activities (BQ inserter tests)"""

    def __init__(self, activity: DetailedStravaActivity):
        self.activity = activity

    def read_activity_by_id(self, activity_id: int) -> DetailedStravaActivity:
        return self.activity

    def read_activities_by_year(self, year: int) -> list[DetailedStravaActivity]:
        return [self.activity]
