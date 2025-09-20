"""Write contracts"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod

from stravabqsync.domain import StravaActivity


class WriteActivities(ABC):
    @abstractmethod
    def write_activity(self, activity: StravaActivity) -> None:
        """Write Strava activity"""

    @abstractmethod
    def write_activity_with_upsert(self, activity: StravaActivity) -> dict:
        """Write Strava activity with upsert logic (handles duplicates)

        Returns:
            dict: Statistics from the operation
        """
