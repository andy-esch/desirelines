"""Domain models for Strava webhook processing."""

from stravapipe.domain.activity import (
    DetailedStravaActivity,
    MinimalStravaActivity,
    SummaryStravaActivity,
)
from stravapipe.domain.auth import StravaTokenSet
from stravapipe.domain.webhook import AspectType, WebhookRequest

__all__ = [
    "AspectType",
    "DetailedStravaActivity",
    "MinimalStravaActivity",
    "StravaTokenSet",
    "SummaryStravaActivity",
    "WebhookRequest",
]
