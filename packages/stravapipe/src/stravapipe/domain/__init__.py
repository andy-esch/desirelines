"""Domain models for Strava webhook processing."""

from stravapipe.domain.activity import (
    DetailedStravaActivity,
    MinimalStravaActivity,
)
from stravapipe.domain.auth import StravaTokenSet
from stravapipe.domain.webhook import AspectType, WebhookRequest

__all__ = [
    # Webhook models
    "AspectType",
    "WebhookRequest",
    # Activity models
    "DetailedStravaActivity",
    "MinimalStravaActivity",
    # Auth models
    "StravaTokenSet",
]
