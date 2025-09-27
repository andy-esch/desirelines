"""Write contracts"""

from abc import ABC, abstractmethod

from aggregator.domain import DistanceTimeseries, PacingTimeseries, StravaActivity


class WriteSummary(ABC):
    @abstractmethod
    def update(self, summary: dict, *, year: int) -> None:
        """Update summary"""


class WritePacings(ABC):
    """Write pacings data to external storage"""

    @abstractmethod
    def update(self, pacing: PacingTimeseries, *, year: int) -> None:
        """Write pacings data to external storage"""


class WriteDistances(ABC):
    """Write pacings data to external storage"""

    @abstractmethod
    def update(self, distances: DistanceTimeseries, *, year: int) -> None:
        """Write pacings data to external storage"""


class UpdateDatabase(ABC):
    """Upload updated database file to external storage"""

    @abstractmethod
    def upload_database(self, file_path: str, year: int) -> None:
        """Upload local database file to storage"""


class WriteLocalActivities(ABC):
    """Write activities to local database"""

    @abstractmethod
    def write_activity(self, activity: StravaActivity) -> None:
        """Write activity to local storage"""
