"""Contracts for read adapters"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod

from stravapipe.domain import (
    DetailedStravaActivity,
    MinimalStravaActivity,
    StravaTokenSet,
)


class ReadStravaToken(ABC):
    """Read Strava access token"""

    @abstractmethod
    def refresh(self) -> StravaTokenSet:
        """Generate a new Strava refresh token"""


class ReadDetailedActivities(ABC):
    """Read detailed Strava activities (for BQ inserter)"""

    @abstractmethod
    def read_activity_by_id(self, activity_id: int) -> DetailedStravaActivity:
        """Read a detailed Strava Activity by ID"""

    @abstractmethod
    def read_activities_by_year(self, year: int) -> list[DetailedStravaActivity]:
        """Read all detailed activities in a year"""


class ReadMinimalActivities(ABC):
    """Read minimal Strava activities (for aggregator)"""

    @abstractmethod
    def read_activity_by_id(self, activity_id: int) -> MinimalStravaActivity:
        """Read a minimal Strava Activity by ID"""

    @abstractmethod
    def read_activities_by_year(self, year: int) -> list[MinimalStravaActivity]:
        """Read all minimal activities in a year"""


class ReadSummaries(ABC):
    """Read activity summaries"""

    @abstractmethod
    def read_activity_summary_by_year(self, year: int) -> dict:
        """Read Activity summaries by year"""
