from desirelines.domain import StravaActivity
from desirelines.ports.out.read import ReadActivities


class MockReadActivities(ReadActivities):
    def __init__(self, activities: dict[int, StravaActivity]):
        self.activities = activities

    def read_activity_by_id(self, activity_id: int) -> StravaActivity:
        return self.activities.get(activity_id)

    def read_activities_by_year(self, year: int) -> list[StravaActivity]:
        pass
