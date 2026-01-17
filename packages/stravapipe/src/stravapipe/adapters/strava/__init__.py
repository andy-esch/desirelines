"""Strava adapters."""

from stravapipe.adapters.strava._repositories import (
    DetailedStravaActivitiesRepo,
    StravaApiConfig,
    StravaTokenRepo,
)
from stravapipe.domain import StravaTokenSet


def make_read_strava_token(tokens: StravaTokenSet) -> StravaTokenRepo:
    """Create a Strava token repository with the given tokens."""
    return StravaTokenRepo(tokens=tokens, api_config=StravaApiConfig())


def make_read_detailed_activities(
    tokens: StravaTokenSet,
) -> DetailedStravaActivitiesRepo:
    """Create a detailed Strava activities repository (for BQ inserter)."""
    return DetailedStravaActivitiesRepo(tokens=tokens, api_config=StravaApiConfig())


def make_read_standard_activities(
    tokens: StravaTokenSet,
) -> DetailedStravaActivitiesRepo:
    """Create a standard Strava activities repository (for PostgreSQL writer).

    Returns DetailedStravaActivitiesRepo which implements ReadStandardActivities.
    Use read_standard_activity_by_id() method.
    """
    return DetailedStravaActivitiesRepo(tokens=tokens, api_config=StravaApiConfig())


__all__ = [
    "DetailedStravaActivitiesRepo",
    "StravaApiConfig",
    "StravaTokenRepo",
    "make_read_detailed_activities",
    "make_read_standard_activities",
    "make_read_strava_token",
]
