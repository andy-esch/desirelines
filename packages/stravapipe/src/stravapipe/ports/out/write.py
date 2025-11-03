"""Write contracts"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod

from stravapipe.domain import DetailedStravaActivity
from stravapipe.types import DistanceTimeseries, SummaryObject
from stravapipe.types.generated.sports_metrics_pb2 import DailySummary, YearMetadata


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
    def update(self, summary: DailySummary, *, year: int, sport: str) -> None:
        """Update summary for a specific sport.

        Args:
            summary: DailySummary protobuf message (contains map of date -> DailyActivity)
            year: Year
            sport: Sport name (e.g., "cycling")
        """


class WriteDistances(ABC):
    """Write distances data to external storage"""

    @abstractmethod
    def update(self, distances: dict[str, DistanceTimeseries], *, year: int, sport: str) -> None:
        """Write distances data to external storage for a specific sport"""


class WriteMetadata(ABC):
    """Write year metadata to external storage"""

    @abstractmethod
    def update(self, metadata: YearMetadata, *, year: int) -> None:
        """Write year metadata with sport totals"""
