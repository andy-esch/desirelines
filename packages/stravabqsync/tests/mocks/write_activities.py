from stravabqsync.domain import StravaActivity
from stravabqsync.ports.out.write import WriteActivities


class MockWriteActivitesRepo(WriteActivities):
    def __init__(self):
        self.activity = None
        self.upsert_stats = {"rows_affected": 1, "execution_time_ms": 100}

    def write_activity(self, activity: StravaActivity) -> dict:
        """Mock implementation of write_activity with upsert logic"""
        self.activity = activity
        return self.upsert_stats
