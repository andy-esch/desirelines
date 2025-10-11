"""Write contracts"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod

from stravapipe.domain import DetailedStravaActivity
from stravapipe.types import DistanceTimeseries, PacingTimeseries, SummaryObject


class WriteActivities(ABC):
    """Write activities to BigQuery"""

    @abstractmethod
    def write_activity(self, activity: DetailedStravaActivity) -> dict:
        """Write Strava activity with upsert logic (handles duplicates)

        Returns:
            dict: Statistics from the operation
        """


class WriteSummary(ABC):
    """Write summary data to Cloud Storage"""

    @abstractmethod
    def update(self, summary: SummaryObject, *, year: int) -> None:
        """Update summary"""


class WritePacings(ABC):
    """Write pacings data to external storage"""

    @abstractmethod
    def update(self, pacing: PacingTimeseries, *, year: int) -> None:
        """Write pacings data to external storage"""


class WriteDistances(ABC):
    """Write distances data to external storage"""

    @abstractmethod
    def update(self, distances: DistanceTimeseries, *, year: int) -> None:
        """Write distances data to external storage"""
