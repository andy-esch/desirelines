from datetime import datetime
from enum import Enum
import json
from typing import Annotated, NamedTuple

from pydantic import BaseModel, Field, field_validator


class AspectType(str, Enum):
    """Strava webhook aspect types.

    Represents the type of change that occurred to trigger a webhook event.
    """

    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"


class WebhookRequest(BaseModel):
    """Strava webhook request payload.

    Validates incoming webhook data to protect against malformed or malicious requests.
    """

    aspect_type: Annotated[AspectType, Field(description="Webhook aspect type")]
    event_time: int
    object_id: int
    object_type: Annotated[
        str, Field(max_length=50, description="Object type being updated")
    ]
    owner_id: int
    subscription_id: int
    updates: Annotated[dict, Field(default_factory=dict, description="Update details")]

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
        """Validate updates field size as defensive programming.

        Even though we don't process the updates field, we validate its size
        to protect against malformed or malicious webhook data that could
        consume excessive memory or cause issues in logging/debugging.

        Strava's actual updates are typically small (< 100 chars), so 2000
        is a reasonable safety limit.
        """
        serialized = str(v)
        if len(serialized) > 2000:
            raise ValueError(
                f"Updates field too large: {len(serialized)} chars (max 2000)"
            )
        return v


class MetaAthlete(BaseModel):
    id: int
    resource_state: int


class PolylineMap(BaseModel):
    id: str
    polyline: str
    resource_state: int
    summary_polyline: str


class MetaActivity(BaseModel):
    id: int
    resource_state: int


class SummarySegment(BaseModel):
    id: int
    resource_state: int
    name: str
    activity_type: str
    distance: float
    average_grade: float
    maximum_grade: float
    elevation_high: float
    elevation_low: float
    start_latlng: list[float]
    end_latlng: list[float]
    climb_category: int
    city: str | None = None
    state: str | None = None
    country: str | None = None
    private: bool
    hazardous: bool
    starred: bool


class DetailedSegmentEffort(BaseModel):
    id: int
    resource_state: int
    name: str
    activity: MetaActivity
    athlete: MetaAthlete
    elapsed_time: int
    moving_time: int
    start_date: datetime
    start_date_local: datetime
    distance: float
    start_index: int
    end_index: int
    average_cadence: float | None = None
    device_watts: bool | None = None
    average_watts: float | None = None
    segment: SummarySegment | None = None
    kom_rank: int | None = None
    pr_rank: int | None
    hidden: bool | None = None


class Split(BaseModel):
    distance: float
    elapsed_time: int
    elevation_difference: float | None = None
    moving_time: int
    split: int
    average_speed: float
    pace_zone: int


class Lap(BaseModel):
    id: int
    resource_state: int
    name: str
    activity: MetaActivity
    athlete: MetaAthlete
    elapsed_time: int
    moving_time: int
    start_date: datetime
    start_date_local: datetime
    distance: float
    start_index: int
    end_index: int
    total_elevation_gain: float | None = None
    average_speed: float
    max_speed: float
    average_cadence: float | None = None
    device_watts: bool | None = None
    average_watts: float | None = None
    lap_index: int
    split: int


class SummaryGear(BaseModel):
    id: str
    primary: bool
    name: str
    resource_state: int
    distance: float


class PhotosSummaryPrimary(BaseModel):
    id: str | None = None
    media_type: int | None = None
    source: int
    unique_id: str
    urls: str

    @field_validator("urls", mode="before")
    def transform_to_json_str(cls, value) -> str:  # noqa: N805 (pydantic validator uses cls, not self)
        return json.dumps(value)


class PhotosSummary(BaseModel):
    primary: PhotosSummaryPrimary | None = None
    count: int


class StatsVisibility(BaseModel):
    type: str
    visibility: str


class StravaActivity(BaseModel):
    id: int
    external_id: str | None = None
    upload_id: int | None = None
    athlete: MetaAthlete
    name: str
    distance: float
    moving_time: int
    elapsed_time: int
    total_elevation_gain: float
    elev_high: float | None = None
    elev_low: float | None = None
    type: str
    sport_type: str
    start_date: datetime
    start_date_local: datetime
    timezone: str
    start_latlng: list[float]
    end_latlng: list[float]
    achievement_count: int
    kudos_count: int
    comment_count: int
    athlete_count: int
    photo_count: int
    total_photo_count: int
    map: PolylineMap
    trainer: bool
    commute: bool
    manual: bool
    private: bool
    flagged: bool
    workout_type: int | None = None
    upload_id_str: str | None = None
    average_speed: float
    max_speed: float
    has_kudoed: bool
    hide_from_home: bool
    gear_id: str | None = None
    kilojoules: float | None = None
    average_watts: float | None = None
    device_watts: bool | None = None
    max_watts: int | None = None
    weighted_average_watts: int | None = None
    description: str | None = None
    photos: PhotosSummary
    gear: SummaryGear | None = None
    calories: float
    segment_efforts: list[DetailedSegmentEffort]
    device_name: str | None = None
    embed_token: str
    splits_metric: list[Split] = Field(default_factory=list)
    splits_standard: list[Split] = Field(default_factory=list)
    laps: list[Lap] = Field(default_factory=list)
    best_efforts: list[DetailedSegmentEffort] = Field(default_factory=list)

    # Not in DetailedActivity model
    average_cadence: float | None = None
    has_heartrate: bool
    pr_count: int
    suffer_score: float | None = None
    stats_visibility: list[StatsVisibility] = Field(default_factory=list)
    display_hide_heartrate_option: bool | None = None
    heartrate_opt_out: bool | None = None
    average_heartrate: float | None = None
    max_heartrate: float | None = None
    available_zones: list[str] = Field(default_factory=list)
    visibility: str | None = None


class StravaTokenSet(NamedTuple):
    """OAuth token set for Strava API authentication.

    Contains all necessary credentials for authenticating with Strava's API
    and refreshing access tokens when they expire.
    """

    client_id: int
    client_secret: str
    access_token: str
    refresh_token: str


class GitHubTokenSet(NamedTuple):
    """OAuth token set for GitHub API authentication."""

    github: str
