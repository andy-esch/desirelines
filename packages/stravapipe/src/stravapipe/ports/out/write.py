"""Write contracts"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any

from stravapipe.domain import DetailedStravaActivity


class WriteActivities(ABC):
    """Write activities to BigQuery"""

    @abstractmethod
    def write_activity(self, activity: DetailedStravaActivity) -> Mapping[str, Any]:
        """Write Strava activity with upsert logic (handles duplicates)

        Returns:
            dict: Statistics from the operation
        """
