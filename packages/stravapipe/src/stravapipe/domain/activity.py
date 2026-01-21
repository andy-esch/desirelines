"""Strava activity domain models.

Note on type: ignore[prop-decorator]:
    Pydantic's @computed_field with @property triggers mypy's prop-decorator error
    because mypy doesn't understand decorator chaining that transforms properties.
    This is a mypy limitation, not a code issue. The computed fields work correctly
    at runtime. See: https://github.com/pydantic/pydantic/issues/6612
"""

import json
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator


class MetaAthlete(BaseModel):
    id: int
    resource_state: int


class PolylineMap(BaseModel):
    """Map data from Strava activity.

    Note: polyline is only present in detailed activity responses.
    Summary activities (list endpoint) only have summary_polyline.
    """

    id: str
    polyline: str | None = None  # Only in detailed activity, not summary
    resource_state: int
    summary_polyline: str | None = None


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
    """Photo summary from Strava API.

    Note: The `urls` field comes from Strava as a dict but is stored as a JSON string
    for simpler BigQuery storage. The validator handles this transformation.
    """

    id: str | None = None
    media_type: int | None = None
    source: int
    unique_id: str
    urls: str  # Stored as JSON string; Strava sends dict, validator converts

    @field_validator("urls", mode="before")
    @classmethod
    def transform_to_json_str(cls, value: dict | str) -> str:
        """Convert urls dict from Strava API to JSON string for storage."""
        if isinstance(value, str):
            return value  # Already converted
        return json.dumps(value)


class PhotosSummary(BaseModel):
    primary: PhotosSummaryPrimary | None = None
    count: int


class StatsVisibility(BaseModel):
    type: str
    visibility: str


class SummaryMap(BaseModel):
    """Map for SummaryActivity - only has summary_polyline, not full polyline"""

    id: str
    summary_polyline: str
    resource_state: int


class SummaryStravaActivity(BaseModel):
    """Summary Strava activity from GET /athlete/activities list endpoint.

    This matches Strava's SummaryActivity model. It has most fields from DetailedActivity
    but is missing: segment_efforts, splits, laps, photos, hide_from_home, embed_token.

    Suitable for:
    - Bulk backfilling (1 API call per 100 activities vs 1 per activity)
    - BigQuery insertion (missing fields will be NULL)
    - Aggregation calculations (has distance, date, type, etc.)
    """

    # Core identification
    id: int
    resource_state: int
    external_id: str | None = None
    upload_id: int | None = None
    upload_id_str: str | None = None

    # Athlete info
    athlete: MetaAthlete

    # Activity metadata
    name: str
    type: str
    sport_type: str
    workout_type: int | None = None

    # Distance and time
    distance: float
    moving_time: int
    elapsed_time: int

    # Elevation
    total_elevation_gain: float
    elev_high: float | None = None
    elev_low: float | None = None

    # Date/time
    start_date: datetime
    start_date_local: datetime
    timezone: str
    utc_offset: float | None = None

    # Location
    start_latlng: list[float]
    end_latlng: list[float]
    location_city: str | None = None
    location_state: str | None = None
    location_country: str | None = None

    # Social metrics
    achievement_count: int
    kudos_count: int
    comment_count: int
    athlete_count: int
    photo_count: int
    total_photo_count: int | None = None
    has_kudoed: bool

    # Map data (summary only - no full polyline)
    map: SummaryMap

    # Activity flags
    trainer: bool
    commute: bool
    manual: bool
    private: bool
    flagged: bool
    from_accepted_tag: bool | None = None

    # Performance metrics
    average_speed: float
    max_speed: float
    average_cadence: float | None = None
    average_watts: float | None = None
    weighted_average_watts: int | None = None
    kilojoules: float | None = None
    device_watts: bool | None = None
    max_watts: int | None = None
    has_heartrate: bool | None = None
    average_heartrate: float | None = None
    max_heartrate: float | None = None
    pr_count: int | None = None
    suffer_score: float | None = None

    # Gear
    gear_id: str | None = None
    gear: SummaryGear | None = None

    # Misc
    device_name: str | None = None
    calories: float | None = None
    description: str | None = None
    visibility: str | None = None
    heartrate_opt_out: bool | None = None

    # Fields NOT in SummaryActivity (only in DetailedActivity):
    # - hide_from_home: bool
    # - photos: PhotosSummary
    # - embed_token: str
    # - segment_efforts: list[DetailedSegmentEffort]
    # - splits_metric: list[Split]
    # - splits_standard: list[Split]
    # - laps: list[Lap]
    # - best_efforts: list[DetailedSegmentEffort]
    # - stats_visibility: list[StatsVisibility]
    # - display_hide_heartrate_option: bool
    # - available_zones: list[str]


class MinimalStravaActivity(BaseModel):
    """Minimal Strava activity model for lightweight operations.

    Contains only core fields needed for delete operations and metadata lookups.
    Used by BigQuery adapter's read_activity_metadata() for efficient queries.

    All measurements use Strava's native units:
    - distance: meters
    - moving_time: seconds
    - total_elevation_gain: meters
    """

    id: int
    type: str
    start_date_local: datetime
    distance: float  # meters (Strava's native unit)
    moving_time: int  # seconds
    total_elevation_gain: float  # meters

    @computed_field  # type: ignore[prop-decorator]
    @property
    def date_str(self) -> str:
        """Get date string in YYYY-MM-DD format."""
        return self.start_date_local.date().strftime("%Y-%m-%d")


class StandardActivity(BaseModel):
    """Standard activity model matching PostgreSQL schema.

    Parses directly from Strava API using extra='ignore' to validate
    only fields we care about. More efficient than DetailedActivity
    validation + conversion.

    This is the primary model for PostgreSQL storage and application logic.
    Uses Pydantic v2 with Field descriptions for self-documenting schema.
    """

    model_config = ConfigDict(extra="ignore")

    # Core identification
    id: int = Field(description="Strava activity ID (primary key)")
    athlete: MetaAthlete = Field(description="Athlete metadata containing user ID")

    # Activity metadata
    name: str = Field(description="Activity name/title")
    type: str = Field(description="Strava activity type (Run, Ride, Swim, etc.)")
    sport_type: str = Field(
        description="Strava sport type, normalized to 'sport' column"
    )

    # Date/time
    start_date_local: datetime = Field(description="Local start time of activity")

    # Performance metrics
    distance: float = Field(description="Distance in meters")
    moving_time: int = Field(description="Moving time in seconds")
    elapsed_time: int = Field(description="Total elapsed time in seconds")
    total_elevation_gain: float | None = Field(
        default=None, description="Elevation gain in meters"
    )
    average_speed: float | None = Field(
        default=None, description="Average speed in m/s"
    )
    max_speed: float | None = Field(default=None, description="Maximum speed in m/s")

    # Health metrics
    average_heartrate: float | None = Field(
        default=None, description="Average heart rate in bpm"
    )
    max_heartrate: float | None = Field(
        default=None, description="Maximum heart rate in bpm"
    )

    # Note: Geospatial fields (map, start_latlng, end_latlng) will be added
    # when implementing postgresql-08-geospatial-tables task

    @computed_field  # type: ignore[prop-decorator]
    @property
    def user_id(self) -> str:
        """Extract user_id from athlete.id for database storage."""
        return str(self.athlete.id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sport(self) -> str:
        """Return raw sport_type value for sport column.

        No normalization - store Strava's original value (e.g., "Ride", "MountainBikeRide").
        Categorization logic (grouping into cycling, running, etc.) is handled by
        the frontend/apigateway using sport_types.json config.
        """
        return self.sport_type

    @computed_field  # type: ignore[prop-decorator]
    @property
    def year(self) -> int:
        """Extract year from start_date_local for partitioning."""
        return self.start_date_local.year


class DetailedStravaActivity(BaseModel):
    """Detailed Strava activity model with full Strava API fields.

    Represents a complete activity from Strava's API with all available fields (~60 fields).
    Used by BQ inserter for full storage in BigQuery.
    """

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
