"""Write contracts"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod

from stravabqsync.domain import StravaActivity


class WriteActivities(ABC):
    @abstractmethod
    def write_activity(self, activity: StravaActivity) -> dict:
        """Write Strava activity with upsert logic (handles duplicates)

        Returns:
            dict: Statistics from the operation
        """
