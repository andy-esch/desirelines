from stravabqsync.domain import StravaActivity
from stravabqsync.ports.out.read import ReadActivities


class MockReadActivitiesRepo(ReadActivities):
    def __init__(self, activity: StravaActivity):
        self.activity = activity

    def read_activity_by_id(self, activity_id: int) -> StravaActivity:
        return self.activity
