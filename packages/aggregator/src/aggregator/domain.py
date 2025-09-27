from datetime import datetime
from typing import Annotated, NamedTuple

from pydantic import BaseModel, Field, computed_field, field_validator
from typing_extensions import TypedDict


class WebhookRequest(BaseModel):
    aspect_type: Annotated[str, Field(max_length=20, description="Webhook aspect type")]
    event_time: int
    object_id: int
    object_type: Annotated[
        str, Field(max_length=50, description="Object type being updated")
    ]
    owner_id: int
    subscription_id: int
    updates: Annotated[dict, Field(default_factory=dict, description="Update details")]

    @field_validator("aspect_type")
    @classmethod
    def validate_aspect_type(cls, v):
        valid_aspects = ["create", "update", "delete"]
        if v not in valid_aspects:
            raise ValueError(
                f"Invalid aspect_type: {v}. Must be one of {valid_aspects}"
            )
        return v

    @field_validator("object_type")
    @classmethod
    def validate_object_type(cls, v):
        # We only handle activity webhooks
        if v != "activity":
            raise ValueError(
                f"Unsupported object_type: {v}. Only 'activity' is supported"
            )
        return v

    @field_validator("updates")
    @classmethod
    def validate_updates_size(cls, v):
        # Reasonable limit for updates field - Strava updates are typically small
        serialized = str(v)
        if len(serialized) > 2000:
            raise ValueError(
                f"Updates field too large: {len(serialized)} chars (max 2000)"
            )
        return v


class StravaActivity(BaseModel):
    id: int
    type: str
    start_date_local: datetime
    distance: float

    @computed_field  # type: ignore
    @property
    def distance_miles(self) -> float:
        """Convert meters to miles"""
        return self.distance / 1000.0 * 0.62137

    @computed_field  # type: ignore
    @property
    def date_str(self) -> str:
        return self.start_date_local.date().strftime("%Y-%m-%d")


class StravaTokenSet(NamedTuple):
    client_id: int
    client_secret: str
    access_token: str
    refresh_token: str


class GitHubTokenSet(NamedTuple):
    github: str


# {
#     "2023-01-01": {
#         "distance_miles": 13.232,
#         "activity_ids": [1234, 2345]
#     },
#     "2023-01-04": {
#         "distance_miles": 20.104,
#         "activity_ids": [3456]
#     }
# }
# TODO make this into a pydantic model
class SummaryEntry(TypedDict):
    distance_miles: float
    activity_ids: list[int]


class TimeseriesEntry(TypedDict):
    x: str
    y: float


SummaryObject = dict[str, SummaryEntry]
DistanceTimeseries = list[TimeseriesEntry]
PacingTimeseries = list[TimeseriesEntry]
