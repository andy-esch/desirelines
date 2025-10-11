"""Strava adapters."""

from stravapipe.adapters.strava._repositories import (
    DetailedStravaActivitiesRepo,
    MinimalStravaActivitiesRepo,
    StravaApiConfig,
    StravaTokenRepo,
)
from stravapipe.domain import StravaTokenSet


def make_read_strava_token(tokens: StravaTokenSet) -> StravaTokenRepo:
    """Create a Strava token repository with the given tokens."""
    return StravaTokenRepo(tokens=tokens, api_config=StravaApiConfig())


def make_read_detailed_activities(tokens: StravaTokenSet) -> DetailedStravaActivitiesRepo:
    """Create a detailed Strava activities repository (for BQ inserter)."""
    return DetailedStravaActivitiesRepo(tokens=tokens, api_config=StravaApiConfig())


def make_read_minimal_activities(tokens: StravaTokenSet) -> MinimalStravaActivitiesRepo:
    """Create a minimal Strava activities repository (for aggregator)."""
    return MinimalStravaActivitiesRepo(tokens=tokens, api_config=StravaApiConfig())


__all__ = [
    "DetailedStravaActivitiesRepo",
    "MinimalStravaActivitiesRepo",
    "StravaApiConfig",
    "StravaTokenRepo",
    "make_read_detailed_activities",
    "make_read_minimal_activities",
    "make_read_strava_token",
]
