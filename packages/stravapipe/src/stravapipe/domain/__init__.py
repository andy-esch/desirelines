"""Domain models for Strava webhook processing."""

from stravapipe.domain.activity import (
    DetailedStravaActivity,
    MetaAthlete,
    MinimalStravaActivity,
    PolylineMap,
    StandardActivity,
    SummaryStravaActivity,
)
from stravapipe.domain.auth import StravaTokenSet
from stravapipe.domain.webhook import AspectType, WebhookRequest

__all__ = [
    "AspectType",
    "DetailedStravaActivity",
    "MetaAthlete",
    "MinimalStravaActivity",
    "PolylineMap",
    "StandardActivity",
    "StravaTokenSet",
    "SummaryStravaActivity",
    "WebhookRequest",
]
