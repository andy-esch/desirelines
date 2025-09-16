"""Contracts for adapters"""

from abc import ABC, abstractmethod

from desirelines.domain import StravaActivity, StravaTokenSet


class ReadStravaToken(ABC):
    """Read Strava access token"""

    @property
    @abstractmethod
    def refresh(self) -> StravaTokenSet:
        """Generate a new Strava refresh token"""


class ReadActivities(ABC):
    """Read Strava activities from generic sources"""

    @abstractmethod
    def read_activity_by_id(self, activity_id: int) -> StravaActivity:
        """Read a Strava Activity by ID"""

    @abstractmethod
    def read_activities_by_year(self, year: int) -> list[StravaActivity]:
        """Read all activities in a year"""


class ReadSummaries(ABC):
    """Read activity summaries"""

    @abstractmethod
    def read_activity_summary_by_year(self, year: int) -> dict:
        """Read Activity summaries by year"""


class FetchDatabase(ABC):
    """Fetch database file from external storage"""

    @abstractmethod
    def download_database(self, year: int) -> str:
        """Download database file from storage and return local file path"""


class ReadLocalActivities(ABC):
    """Read local activities from database"""

    @abstractmethod
    def read_activities(self) -> list[StravaActivity]:
        """Read activities from local storage"""
