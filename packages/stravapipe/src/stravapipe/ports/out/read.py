"""Contracts for read adapters"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod
from collections.abc import Sequence

from stravapipe.domain import (
    DetailedStravaActivity,
    MinimalStravaActivity,
    StravaTokenSet,
    SummaryStravaActivity,
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
    def read_activities_by_year(
        self, year: int
    ) -> Sequence[DetailedStravaActivity | SummaryStravaActivity]:
        """Read all activities in a year

        Returns DetailedStravaActivity (from detail endpoint) or
        SummaryStravaActivity (from list endpoint).
        """


class ReadMinimalActivities(ABC):
    """Read minimal Strava activities (for aggregator)"""

    @abstractmethod
    def read_activity_by_id(self, activity_id: int) -> MinimalStravaActivity:
        """Read a minimal Strava Activity by ID"""

    @abstractmethod
    def read_activities_by_year(self, year: int) -> list[MinimalStravaActivity]:
        """Read all minimal activities in a year"""


class ReadActivitiesMetadata(ABC):
    """Read minimal activity metadata from BigQuery for delete operations"""

    @abstractmethod
    def read_activity_metadata(self, activity_id: int) -> MinimalStravaActivity:
        """Get minimal activity data (id, type, date, distance) from BigQuery

        Used by delete operations to get activity metadata without calling
        Strava API. Checks both activities and deleted_activities tables
        to handle race conditions.
        """


class ReadSummaries(ABC):
    """Read activity summaries"""

    @abstractmethod
    def read_activity_summary_by_year(self, year: int) -> dict:
        """Read Activity summaries by year"""
