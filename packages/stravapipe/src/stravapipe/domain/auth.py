"""Authentication domain models."""

from typing import NamedTuple


class StravaTokenSet(NamedTuple):
    """OAuth token set for Strava API authentication.

    Contains all necessary credentials for authenticating with Strava's API
    and refreshing access tokens when they expire.
    """

    client_id: int
    client_secret: str
    access_token: str
    refresh_token: str
