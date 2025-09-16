"""Contracts for adapters"""

# pylint: disable=too-few-public-methods
from abc import ABC, abstractmethod

from stravabqsync.domain import StravaActivity, StravaTokenSet


class ReadStravaToken(ABC):
    """Read Strava access token"""

    @abstractmethod
    def refresh(self) -> StravaTokenSet:
        """Generate a new Strava refresh token"""


class ReadActivities(ABC):
    """Read Strava activities from generic sources"""

    @abstractmethod
    def read_activity_by_id(self, activity_id: int) -> StravaActivity:
        """Read a Strava Activity by ID"""
