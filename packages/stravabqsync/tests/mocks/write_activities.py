from stravabqsync.domain import StravaActivity
from stravabqsync.ports.out.write import WriteActivities


class MockWriteActivitesRepo(WriteActivities):
    def __init__(self):
        self.activity = None

    def write_activity(self, activity: StravaActivity) -> None:
        self.activity = activity
