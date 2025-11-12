"""Write contracts"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod

from stravapipe.domain import DetailedStravaActivity
from stravapipe.types.generated.sports_metrics_pb2 import (
    CumulativeMetricsEntry,
    DailySummary,
    YearMetadata,
)


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
    """Write cumulative metrics data to external storage"""

    @abstractmethod
    def update(
        self, metrics: list[CumulativeMetricsEntry], *, year: int, sport: str
    ) -> None:
        """Write cumulative metrics timeseries to external storage for a specific sport

        Args:
            metrics: List of CumulativeMetricsEntry protobuf messages
            year: Year
            sport: Sport name (e.g., "cycling", "running", "yoga")
        """


class WriteMetadata(ABC):
    """Write year metadata to external storage"""

    @abstractmethod
    def update(self, metadata: YearMetadata, *, year: int) -> None:
        """Write year metadata with sport totals"""
