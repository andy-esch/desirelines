"""Strava adapters.

Provides a layered architecture for Strava API access:

    StravaTokenRepo      - Refreshes tokens via Strava OAuth API
    StravaTokenManager   - Manages token state + thread-safety
    StravaApiClient      - HTTP calls, 401 retry, error translation
    StravaActivitiesRepo - Domain model conversion

Use the factory functions (make_read_*) to create properly wired instances.
"""

from stravapipe.adapters.strava._repositories import (
    StravaActivitiesRepo,
    StravaApiClient,
    StravaTokenManager,
    StravaTokenRepo,
    create_strava_activities_repo,
)
from stravapipe.config.common import StravaApiConfig
from stravapipe.domain import StravaTokenSet


def make_read_strava_token(tokens: StravaTokenSet) -> StravaTokenRepo:
    """Create a Strava token repository with the given tokens."""
    return StravaTokenRepo(tokens=tokens, api_config=StravaApiConfig())


def make_read_detailed_activities(
    tokens: StravaTokenSet,
) -> StravaActivitiesRepo:
    """Create a Strava activities repository (for BQ inserter).

    Returns StravaActivitiesRepo which implements ReadDetailedActivities.
    Use read_activity_by_id() for detailed activities.
    """
    return create_strava_activities_repo(tokens=tokens, api_config=StravaApiConfig())


def make_read_standard_activities(
    tokens: StravaTokenSet,
) -> StravaActivitiesRepo:
    """Create a Strava activities repository (for PostgreSQL writer).

    Returns StravaActivitiesRepo which implements ReadStandardActivities.
    Use read_standard_activity_by_id() for standard activities.
    """
    return create_strava_activities_repo(tokens=tokens, api_config=StravaApiConfig())


__all__ = [
    "StravaActivitiesRepo",
    "StravaApiClient",
    "StravaApiConfig",
    "StravaTokenManager",
    "StravaTokenRepo",
    "create_strava_activities_repo",
    "make_read_detailed_activities",
    "make_read_standard_activities",
    "make_read_strava_token",
]
