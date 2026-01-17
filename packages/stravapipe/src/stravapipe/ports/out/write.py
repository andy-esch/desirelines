"""Write contracts"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod

from stravapipe.domain import DetailedStravaActivity


class WriteActivities(ABC):
    """Write activities to BigQuery"""

    @abstractmethod
    def write_activity(self, activity: DetailedStravaActivity) -> dict:
        """Write Strava activity with upsert logic (handles duplicates)

        Returns:
            dict: Statistics from the operation
        """
