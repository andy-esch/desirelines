"""Contracts for read adapters"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod
from collections.abc import Sequence

from stravapipe.domain import (
    DetailedStravaActivity,
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
        """Read a detailed Strava Activity by ID (all ~60 fields)"""

    @abstractmethod
    def read_activities_by_year(
        self, year: int
    ) -> Sequence[DetailedStravaActivity | SummaryStravaActivity]:
        """Read all activities in a year

        Returns DetailedStravaActivity (from detail endpoint) or
        SummaryStravaActivity (from list endpoint).
        """
