from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Activity(_message.Message):
    __slots__ = ("id", "external_id", "upload_id", "athlete", "name", "distance", "moving_time", "elapsed_time", "total_elevation_gain", "elev_high", "elev_low", "type", "sport_type", "start_date", "start_date_local", "timezone", "start_latlng", "end_latlng", "achievement_count", "kudos_count", "comment_count", "athlete_count", "photo_count", "total_photo_count", "map", "trainer", "commute", "manual", "private", "flagged", "workout_type", "upload_id_str", "average_speed", "max_speed", "has_kudoed", "hide_from_home", "gear_id", "kilojoules", "average_watts", "device_watts", "max_watts", "weighted_average_watts", "description", "photos", "gear", "calories", "segment_efforts", "device_name", "embed_token", "splits_metric", "splits_standard", "laps", "best_efforts", "average_cadence", "has_heartrate", "pr_count", "suffer_score", "stats_visibility", "display_hide_heartrate_option", "heartrate_opt_out", "average_heartrate", "max_heartrate", "available_zones", "visibility")
    class Athlete(_message.Message):
        __slots__ = ("id", "resource_state")
        ID_FIELD_NUMBER: _ClassVar[int]
        RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
        id: int
        resource_state: int
        def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ...) -> None: ...
    class Map(_message.Message):
        __slots__ = ("id", "polyline", "resource_state", "summary_polyline")
        ID_FIELD_NUMBER: _ClassVar[int]
        POLYLINE_FIELD_NUMBER: _ClassVar[int]
        RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
        SUMMARY_POLYLINE_FIELD_NUMBER: _ClassVar[int]
        id: str
        polyline: str
        resource_state: int
        summary_polyline: str
        def __init__(self, id: _Optional[str] = ..., polyline: _Optional[str] = ..., resource_state: _Optional[int] = ..., summary_polyline: _Optional[str] = ...) -> None: ...
    class Photos(_message.Message):
        __slots__ = ("primary", "count")
        class Primary(_message.Message):
            __slots__ = ("id", "media_type", "source", "unique_id", "urls")
            ID_FIELD_NUMBER: _ClassVar[int]
            MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
            SOURCE_FIELD_NUMBER: _ClassVar[int]
            UNIQUE_ID_FIELD_NUMBER: _ClassVar[int]
            URLS_FIELD_NUMBER: _ClassVar[int]
            id: str
            media_type: int
            source: int
            unique_id: str
            urls: str
            def __init__(self, id: _Optional[str] = ..., media_type: _Optional[int] = ..., source: _Optional[int] = ..., unique_id: _Optional[str] = ..., urls: _Optional[str] = ...) -> None: ...
        PRIMARY_FIELD_NUMBER: _ClassVar[int]
        COUNT_FIELD_NUMBER: _ClassVar[int]
        primary: Activity.Photos.Primary
        count: int
        def __init__(self, primary: _Optional[_Union[Activity.Photos.Primary, _Mapping]] = ..., count: _Optional[int] = ...) -> None: ...
    class Gear(_message.Message):
        __slots__ = ("id", "primary", "name", "resource_state", "distance")
        ID_FIELD_NUMBER: _ClassVar[int]
        PRIMARY_FIELD_NUMBER: _ClassVar[int]
        NAME_FIELD_NUMBER: _ClassVar[int]
        RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
        DISTANCE_FIELD_NUMBER: _ClassVar[int]
        id: str
        primary: bool
        name: str
        resource_state: int
        distance: float
        def __init__(self, id: _Optional[str] = ..., primary: bool = ..., name: _Optional[str] = ..., resource_state: _Optional[int] = ..., distance: _Optional[float] = ...) -> None: ...
    class SegmentEfforts(_message.Message):
        __slots__ = ("id", "resource_state", "name", "activity", "athlete", "elapsed_time", "moving_time", "start_date", "start_date_local", "distance", "start_index", "end_index", "average_cadence", "device_watts", "average_watts", "segment", "kom_rank", "pr_rank", "hidden")
        class Activity(_message.Message):
            __slots__ = ("id", "resource_state")
            ID_FIELD_NUMBER: _ClassVar[int]
            RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
            id: int
            resource_state: int
            def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ...) -> None: ...
        class Athlete(_message.Message):
            __slots__ = ("id", "resource_state")
            ID_FIELD_NUMBER: _ClassVar[int]
            RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
            id: int
            resource_state: int
            def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ...) -> None: ...
        class Segment(_message.Message):
            __slots__ = ("id", "resource_state", "name", "activity_type", "distance", "average_grade", "maximum_grade", "elevation_high", "elevation_low", "start_latlng", "end_latlng", "climb_category", "city", "state", "country", "private", "hazardous", "starred")
            ID_FIELD_NUMBER: _ClassVar[int]
            RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
            NAME_FIELD_NUMBER: _ClassVar[int]
            ACTIVITY_TYPE_FIELD_NUMBER: _ClassVar[int]
            DISTANCE_FIELD_NUMBER: _ClassVar[int]
            AVERAGE_GRADE_FIELD_NUMBER: _ClassVar[int]
            MAXIMUM_GRADE_FIELD_NUMBER: _ClassVar[int]
            ELEVATION_HIGH_FIELD_NUMBER: _ClassVar[int]
            ELEVATION_LOW_FIELD_NUMBER: _ClassVar[int]
            START_LATLNG_FIELD_NUMBER: _ClassVar[int]
            END_LATLNG_FIELD_NUMBER: _ClassVar[int]
            CLIMB_CATEGORY_FIELD_NUMBER: _ClassVar[int]
            CITY_FIELD_NUMBER: _ClassVar[int]
            STATE_FIELD_NUMBER: _ClassVar[int]
            COUNTRY_FIELD_NUMBER: _ClassVar[int]
            PRIVATE_FIELD_NUMBER: _ClassVar[int]
            HAZARDOUS_FIELD_NUMBER: _ClassVar[int]
            STARRED_FIELD_NUMBER: _ClassVar[int]
            id: int
            resource_state: int
            name: str
            activity_type: str
            distance: float
            average_grade: float
            maximum_grade: float
            elevation_high: float
            elevation_low: float
            start_latlng: _containers.RepeatedScalarFieldContainer[float]
            end_latlng: _containers.RepeatedScalarFieldContainer[float]
            climb_category: int
            city: str
            state: str
            country: str
            private: bool
            hazardous: bool
            starred: bool
            def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ..., name: _Optional[str] = ..., activity_type: _Optional[str] = ..., distance: _Optional[float] = ..., average_grade: _Optional[float] = ..., maximum_grade: _Optional[float] = ..., elevation_high: _Optional[float] = ..., elevation_low: _Optional[float] = ..., start_latlng: _Optional[_Iterable[float]] = ..., end_latlng: _Optional[_Iterable[float]] = ..., climb_category: _Optional[int] = ..., city: _Optional[str] = ..., state: _Optional[str] = ..., country: _Optional[str] = ..., private: bool = ..., hazardous: bool = ..., starred: bool = ...) -> None: ...
        ID_FIELD_NUMBER: _ClassVar[int]
        RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
        NAME_FIELD_NUMBER: _ClassVar[int]
        ACTIVITY_FIELD_NUMBER: _ClassVar[int]
        ATHLETE_FIELD_NUMBER: _ClassVar[int]
        ELAPSED_TIME_FIELD_NUMBER: _ClassVar[int]
        MOVING_TIME_FIELD_NUMBER: _ClassVar[int]
        START_DATE_FIELD_NUMBER: _ClassVar[int]
        START_DATE_LOCAL_FIELD_NUMBER: _ClassVar[int]
        DISTANCE_FIELD_NUMBER: _ClassVar[int]
        START_INDEX_FIELD_NUMBER: _ClassVar[int]
        END_INDEX_FIELD_NUMBER: _ClassVar[int]
        AVERAGE_CADENCE_FIELD_NUMBER: _ClassVar[int]
        DEVICE_WATTS_FIELD_NUMBER: _ClassVar[int]
        AVERAGE_WATTS_FIELD_NUMBER: _ClassVar[int]
        SEGMENT_FIELD_NUMBER: _ClassVar[int]
        KOM_RANK_FIELD_NUMBER: _ClassVar[int]
        PR_RANK_FIELD_NUMBER: _ClassVar[int]
        HIDDEN_FIELD_NUMBER: _ClassVar[int]
        id: int
        resource_state: int
        name: str
        activity: Activity.SegmentEfforts.Activity
        athlete: Activity.SegmentEfforts.Athlete
        elapsed_time: int
        moving_time: int
        start_date: int
        start_date_local: int
        distance: float
        start_index: int
        end_index: int
        average_cadence: float
        device_watts: bool
        average_watts: float
        segment: Activity.SegmentEfforts.Segment
        kom_rank: int
        pr_rank: int
        hidden: bool
        def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ..., name: _Optional[str] = ..., activity: _Optional[_Union[Activity.SegmentEfforts.Activity, _Mapping]] = ..., athlete: _Optional[_Union[Activity.SegmentEfforts.Athlete, _Mapping]] = ..., elapsed_time: _Optional[int] = ..., moving_time: _Optional[int] = ..., start_date: _Optional[int] = ..., start_date_local: _Optional[int] = ..., distance: _Optional[float] = ..., start_index: _Optional[int] = ..., end_index: _Optional[int] = ..., average_cadence: _Optional[float] = ..., device_watts: bool = ..., average_watts: _Optional[float] = ..., segment: _Optional[_Union[Activity.SegmentEfforts.Segment, _Mapping]] = ..., kom_rank: _Optional[int] = ..., pr_rank: _Optional[int] = ..., hidden: bool = ...) -> None: ...
    class SplitsMetric(_message.Message):
        __slots__ = ("distance", "elapsed_time", "elevation_difference", "moving_time", "split", "average_speed", "pace_zone")
        DISTANCE_FIELD_NUMBER: _ClassVar[int]
        ELAPSED_TIME_FIELD_NUMBER: _ClassVar[int]
        ELEVATION_DIFFERENCE_FIELD_NUMBER: _ClassVar[int]
        MOVING_TIME_FIELD_NUMBER: _ClassVar[int]
        SPLIT_FIELD_NUMBER: _ClassVar[int]
        AVERAGE_SPEED_FIELD_NUMBER: _ClassVar[int]
        PACE_ZONE_FIELD_NUMBER: _ClassVar[int]
        distance: float
        elapsed_time: int
        elevation_difference: float
        moving_time: int
        split: int
        average_speed: float
        pace_zone: int
        def __init__(self, distance: _Optional[float] = ..., elapsed_time: _Optional[int] = ..., elevation_difference: _Optional[float] = ..., moving_time: _Optional[int] = ..., split: _Optional[int] = ..., average_speed: _Optional[float] = ..., pace_zone: _Optional[int] = ...) -> None: ...
    class SplitsStandard(_message.Message):
        __slots__ = ("distance", "elapsed_time", "elevation_difference", "moving_time", "split", "average_speed", "pace_zone")
        DISTANCE_FIELD_NUMBER: _ClassVar[int]
        ELAPSED_TIME_FIELD_NUMBER: _ClassVar[int]
        ELEVATION_DIFFERENCE_FIELD_NUMBER: _ClassVar[int]
        MOVING_TIME_FIELD_NUMBER: _ClassVar[int]
        SPLIT_FIELD_NUMBER: _ClassVar[int]
        AVERAGE_SPEED_FIELD_NUMBER: _ClassVar[int]
        PACE_ZONE_FIELD_NUMBER: _ClassVar[int]
        distance: float
        elapsed_time: int
        elevation_difference: float
        moving_time: int
        split: int
        average_speed: float
        pace_zone: int
        def __init__(self, distance: _Optional[float] = ..., elapsed_time: _Optional[int] = ..., elevation_difference: _Optional[float] = ..., moving_time: _Optional[int] = ..., split: _Optional[int] = ..., average_speed: _Optional[float] = ..., pace_zone: _Optional[int] = ...) -> None: ...
    class Laps(_message.Message):
        __slots__ = ("id", "resource_state", "name", "activity", "athlete", "elapsed_time", "moving_time", "start_date", "start_date_local", "distance", "start_index", "end_index", "total_elevation_gain", "average_speed", "max_speed", "average_cadence", "device_watts", "average_watts", "lap_index", "split")
        class Activity(_message.Message):
            __slots__ = ("id", "resource_state")
            ID_FIELD_NUMBER: _ClassVar[int]
            RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
            id: int
            resource_state: int
            def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ...) -> None: ...
        class Athlete(_message.Message):
            __slots__ = ("id", "resource_state")
            ID_FIELD_NUMBER: _ClassVar[int]
            RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
            id: int
            resource_state: int
            def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ...) -> None: ...
        ID_FIELD_NUMBER: _ClassVar[int]
        RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
        NAME_FIELD_NUMBER: _ClassVar[int]
        ACTIVITY_FIELD_NUMBER: _ClassVar[int]
        ATHLETE_FIELD_NUMBER: _ClassVar[int]
        ELAPSED_TIME_FIELD_NUMBER: _ClassVar[int]
        MOVING_TIME_FIELD_NUMBER: _ClassVar[int]
        START_DATE_FIELD_NUMBER: _ClassVar[int]
        START_DATE_LOCAL_FIELD_NUMBER: _ClassVar[int]
        DISTANCE_FIELD_NUMBER: _ClassVar[int]
        START_INDEX_FIELD_NUMBER: _ClassVar[int]
        END_INDEX_FIELD_NUMBER: _ClassVar[int]
        TOTAL_ELEVATION_GAIN_FIELD_NUMBER: _ClassVar[int]
        AVERAGE_SPEED_FIELD_NUMBER: _ClassVar[int]
        MAX_SPEED_FIELD_NUMBER: _ClassVar[int]
        AVERAGE_CADENCE_FIELD_NUMBER: _ClassVar[int]
        DEVICE_WATTS_FIELD_NUMBER: _ClassVar[int]
        AVERAGE_WATTS_FIELD_NUMBER: _ClassVar[int]
        LAP_INDEX_FIELD_NUMBER: _ClassVar[int]
        SPLIT_FIELD_NUMBER: _ClassVar[int]
        id: int
        resource_state: int
        name: str
        activity: Activity.Laps.Activity
        athlete: Activity.Laps.Athlete
        elapsed_time: int
        moving_time: int
        start_date: int
        start_date_local: int
        distance: float
        start_index: int
        end_index: int
        total_elevation_gain: float
        average_speed: float
        max_speed: float
        average_cadence: float
        device_watts: bool
        average_watts: float
        lap_index: int
        split: int
        def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ..., name: _Optional[str] = ..., activity: _Optional[_Union[Activity.Laps.Activity, _Mapping]] = ..., athlete: _Optional[_Union[Activity.Laps.Athlete, _Mapping]] = ..., elapsed_time: _Optional[int] = ..., moving_time: _Optional[int] = ..., start_date: _Optional[int] = ..., start_date_local: _Optional[int] = ..., distance: _Optional[float] = ..., start_index: _Optional[int] = ..., end_index: _Optional[int] = ..., total_elevation_gain: _Optional[float] = ..., average_speed: _Optional[float] = ..., max_speed: _Optional[float] = ..., average_cadence: _Optional[float] = ..., device_watts: bool = ..., average_watts: _Optional[float] = ..., lap_index: _Optional[int] = ..., split: _Optional[int] = ...) -> None: ...
    class BestEfforts(_message.Message):
        __slots__ = ("id", "resource_state", "name", "activity", "athlete", "elapsed_time", "moving_time", "start_date", "start_date_local", "distance", "start_index", "end_index", "average_cadence", "device_watts", "average_watts", "segment", "kom_rank", "pr_rank", "hidden")
        class Activity(_message.Message):
            __slots__ = ("id", "resource_state")
            ID_FIELD_NUMBER: _ClassVar[int]
            RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
            id: int
            resource_state: int
            def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ...) -> None: ...
        class Athlete(_message.Message):
            __slots__ = ("id", "resource_state")
            ID_FIELD_NUMBER: _ClassVar[int]
            RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
            id: int
            resource_state: int
            def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ...) -> None: ...
        class Segment(_message.Message):
            __slots__ = ("id", "resource_state", "name", "activity_type", "distance", "average_grade", "maximum_grade", "elevation_high", "elevation_low", "start_latlng", "end_latlng", "climb_category", "city", "state", "country", "private", "hazardous", "starred")
            ID_FIELD_NUMBER: _ClassVar[int]
            RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
            NAME_FIELD_NUMBER: _ClassVar[int]
            ACTIVITY_TYPE_FIELD_NUMBER: _ClassVar[int]
            DISTANCE_FIELD_NUMBER: _ClassVar[int]
            AVERAGE_GRADE_FIELD_NUMBER: _ClassVar[int]
            MAXIMUM_GRADE_FIELD_NUMBER: _ClassVar[int]
            ELEVATION_HIGH_FIELD_NUMBER: _ClassVar[int]
            ELEVATION_LOW_FIELD_NUMBER: _ClassVar[int]
            START_LATLNG_FIELD_NUMBER: _ClassVar[int]
            END_LATLNG_FIELD_NUMBER: _ClassVar[int]
            CLIMB_CATEGORY_FIELD_NUMBER: _ClassVar[int]
            CITY_FIELD_NUMBER: _ClassVar[int]
            STATE_FIELD_NUMBER: _ClassVar[int]
            COUNTRY_FIELD_NUMBER: _ClassVar[int]
            PRIVATE_FIELD_NUMBER: _ClassVar[int]
            HAZARDOUS_FIELD_NUMBER: _ClassVar[int]
            STARRED_FIELD_NUMBER: _ClassVar[int]
            id: int
            resource_state: int
            name: str
            activity_type: str
            distance: float
            average_grade: float
            maximum_grade: float
            elevation_high: float
            elevation_low: float
            start_latlng: _containers.RepeatedScalarFieldContainer[float]
            end_latlng: _containers.RepeatedScalarFieldContainer[float]
            climb_category: int
            city: str
            state: str
            country: str
            private: bool
            hazardous: bool
            starred: bool
            def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ..., name: _Optional[str] = ..., activity_type: _Optional[str] = ..., distance: _Optional[float] = ..., average_grade: _Optional[float] = ..., maximum_grade: _Optional[float] = ..., elevation_high: _Optional[float] = ..., elevation_low: _Optional[float] = ..., start_latlng: _Optional[_Iterable[float]] = ..., end_latlng: _Optional[_Iterable[float]] = ..., climb_category: _Optional[int] = ..., city: _Optional[str] = ..., state: _Optional[str] = ..., country: _Optional[str] = ..., private: bool = ..., hazardous: bool = ..., starred: bool = ...) -> None: ...
        ID_FIELD_NUMBER: _ClassVar[int]
        RESOURCE_STATE_FIELD_NUMBER: _ClassVar[int]
        NAME_FIELD_NUMBER: _ClassVar[int]
        ACTIVITY_FIELD_NUMBER: _ClassVar[int]
        ATHLETE_FIELD_NUMBER: _ClassVar[int]
        ELAPSED_TIME_FIELD_NUMBER: _ClassVar[int]
        MOVING_TIME_FIELD_NUMBER: _ClassVar[int]
        START_DATE_FIELD_NUMBER: _ClassVar[int]
        START_DATE_LOCAL_FIELD_NUMBER: _ClassVar[int]
        DISTANCE_FIELD_NUMBER: _ClassVar[int]
        START_INDEX_FIELD_NUMBER: _ClassVar[int]
        END_INDEX_FIELD_NUMBER: _ClassVar[int]
        AVERAGE_CADENCE_FIELD_NUMBER: _ClassVar[int]
        DEVICE_WATTS_FIELD_NUMBER: _ClassVar[int]
        AVERAGE_WATTS_FIELD_NUMBER: _ClassVar[int]
        SEGMENT_FIELD_NUMBER: _ClassVar[int]
        KOM_RANK_FIELD_NUMBER: _ClassVar[int]
        PR_RANK_FIELD_NUMBER: _ClassVar[int]
        HIDDEN_FIELD_NUMBER: _ClassVar[int]
        id: int
        resource_state: int
        name: str
        activity: Activity.BestEfforts.Activity
        athlete: Activity.BestEfforts.Athlete
        elapsed_time: int
        moving_time: int
        start_date: int
        start_date_local: int
        distance: float
        start_index: int
        end_index: int
        average_cadence: float
        device_watts: bool
        average_watts: float
        segment: Activity.BestEfforts.Segment
        kom_rank: int
        pr_rank: int
        hidden: bool
        def __init__(self, id: _Optional[int] = ..., resource_state: _Optional[int] = ..., name: _Optional[str] = ..., activity: _Optional[_Union[Activity.BestEfforts.Activity, _Mapping]] = ..., athlete: _Optional[_Union[Activity.BestEfforts.Athlete, _Mapping]] = ..., elapsed_time: _Optional[int] = ..., moving_time: _Optional[int] = ..., start_date: _Optional[int] = ..., start_date_local: _Optional[int] = ..., distance: _Optional[float] = ..., start_index: _Optional[int] = ..., end_index: _Optional[int] = ..., average_cadence: _Optional[float] = ..., device_watts: bool = ..., average_watts: _Optional[float] = ..., segment: _Optional[_Union[Activity.BestEfforts.Segment, _Mapping]] = ..., kom_rank: _Optional[int] = ..., pr_rank: _Optional[int] = ..., hidden: bool = ...) -> None: ...
    class StatsVisibility(_message.Message):
        __slots__ = ("type", "visibility")
        TYPE_FIELD_NUMBER: _ClassVar[int]
        VISIBILITY_FIELD_NUMBER: _ClassVar[int]
        type: str
        visibility: str
        def __init__(self, type: _Optional[str] = ..., visibility: _Optional[str] = ...) -> None: ...
    ID_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_ID_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_ID_FIELD_NUMBER: _ClassVar[int]
    ATHLETE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISTANCE_FIELD_NUMBER: _ClassVar[int]
    MOVING_TIME_FIELD_NUMBER: _ClassVar[int]
    ELAPSED_TIME_FIELD_NUMBER: _ClassVar[int]
    TOTAL_ELEVATION_GAIN_FIELD_NUMBER: _ClassVar[int]
    ELEV_HIGH_FIELD_NUMBER: _ClassVar[int]
    ELEV_LOW_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    SPORT_TYPE_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    START_DATE_LOCAL_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    START_LATLNG_FIELD_NUMBER: _ClassVar[int]
    END_LATLNG_FIELD_NUMBER: _ClassVar[int]
    ACHIEVEMENT_COUNT_FIELD_NUMBER: _ClassVar[int]
    KUDOS_COUNT_FIELD_NUMBER: _ClassVar[int]
    COMMENT_COUNT_FIELD_NUMBER: _ClassVar[int]
    ATHLETE_COUNT_FIELD_NUMBER: _ClassVar[int]
    PHOTO_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PHOTO_COUNT_FIELD_NUMBER: _ClassVar[int]
    MAP_FIELD_NUMBER: _ClassVar[int]
    TRAINER_FIELD_NUMBER: _ClassVar[int]
    COMMUTE_FIELD_NUMBER: _ClassVar[int]
    MANUAL_FIELD_NUMBER: _ClassVar[int]
    PRIVATE_FIELD_NUMBER: _ClassVar[int]
    FLAGGED_FIELD_NUMBER: _ClassVar[int]
    WORKOUT_TYPE_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_ID_STR_FIELD_NUMBER: _ClassVar[int]
    AVERAGE_SPEED_FIELD_NUMBER: _ClassVar[int]
    MAX_SPEED_FIELD_NUMBER: _ClassVar[int]
    HAS_KUDOED_FIELD_NUMBER: _ClassVar[int]
    HIDE_FROM_HOME_FIELD_NUMBER: _ClassVar[int]
    GEAR_ID_FIELD_NUMBER: _ClassVar[int]
    KILOJOULES_FIELD_NUMBER: _ClassVar[int]
    AVERAGE_WATTS_FIELD_NUMBER: _ClassVar[int]
    DEVICE_WATTS_FIELD_NUMBER: _ClassVar[int]
    MAX_WATTS_FIELD_NUMBER: _ClassVar[int]
    WEIGHTED_AVERAGE_WATTS_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    PHOTOS_FIELD_NUMBER: _ClassVar[int]
    GEAR_FIELD_NUMBER: _ClassVar[int]
    CALORIES_FIELD_NUMBER: _ClassVar[int]
    SEGMENT_EFFORTS_FIELD_NUMBER: _ClassVar[int]
    DEVICE_NAME_FIELD_NUMBER: _ClassVar[int]
    EMBED_TOKEN_FIELD_NUMBER: _ClassVar[int]
    SPLITS_METRIC_FIELD_NUMBER: _ClassVar[int]
    SPLITS_STANDARD_FIELD_NUMBER: _ClassVar[int]
    LAPS_FIELD_NUMBER: _ClassVar[int]
    BEST_EFFORTS_FIELD_NUMBER: _ClassVar[int]
    AVERAGE_CADENCE_FIELD_NUMBER: _ClassVar[int]
    HAS_HEARTRATE_FIELD_NUMBER: _ClassVar[int]
    PR_COUNT_FIELD_NUMBER: _ClassVar[int]
    SUFFER_SCORE_FIELD_NUMBER: _ClassVar[int]
    STATS_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_HIDE_HEARTRATE_OPTION_FIELD_NUMBER: _ClassVar[int]
    HEARTRATE_OPT_OUT_FIELD_NUMBER: _ClassVar[int]
    AVERAGE_HEARTRATE_FIELD_NUMBER: _ClassVar[int]
    MAX_HEARTRATE_FIELD_NUMBER: _ClassVar[int]
    AVAILABLE_ZONES_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    id: int
    external_id: str
    upload_id: int
    athlete: Activity.Athlete
    name: str
    distance: float
    moving_time: int
    elapsed_time: int
    total_elevation_gain: float
    elev_high: float
    elev_low: float
    type: str
    sport_type: str
    start_date: int
    start_date_local: int
    timezone: str
    start_latlng: _containers.RepeatedScalarFieldContainer[float]
    end_latlng: _containers.RepeatedScalarFieldContainer[float]
    achievement_count: int
    kudos_count: int
    comment_count: int
    athlete_count: int
    photo_count: int
    total_photo_count: int
    map: Activity.Map
    trainer: bool
    commute: bool
    manual: bool
    private: bool
    flagged: bool
    workout_type: str
    upload_id_str: str
    average_speed: float
    max_speed: float
    has_kudoed: bool
    hide_from_home: bool
    gear_id: str
    kilojoules: float
    average_watts: float
    device_watts: bool
    max_watts: int
    weighted_average_watts: int
    description: str
    photos: Activity.Photos
    gear: Activity.Gear
    calories: float
    segment_efforts: _containers.RepeatedCompositeFieldContainer[Activity.SegmentEfforts]
    device_name: str
    embed_token: str
    splits_metric: _containers.RepeatedCompositeFieldContainer[Activity.SplitsMetric]
    splits_standard: _containers.RepeatedCompositeFieldContainer[Activity.SplitsStandard]
    laps: _containers.RepeatedCompositeFieldContainer[Activity.Laps]
    best_efforts: _containers.RepeatedCompositeFieldContainer[Activity.BestEfforts]
    average_cadence: float
    has_heartrate: bool
    pr_count: int
    suffer_score: float
    stats_visibility: _containers.RepeatedCompositeFieldContainer[Activity.StatsVisibility]
    display_hide_heartrate_option: bool
    heartrate_opt_out: bool
    average_heartrate: float
    max_heartrate: float
    available_zones: _containers.RepeatedScalarFieldContainer[str]
    visibility: str
    def __init__(self, id: _Optional[int] = ..., external_id: _Optional[str] = ..., upload_id: _Optional[int] = ..., athlete: _Optional[_Union[Activity.Athlete, _Mapping]] = ..., name: _Optional[str] = ..., distance: _Optional[float] = ..., moving_time: _Optional[int] = ..., elapsed_time: _Optional[int] = ..., total_elevation_gain: _Optional[float] = ..., elev_high: _Optional[float] = ..., elev_low: _Optional[float] = ..., type: _Optional[str] = ..., sport_type: _Optional[str] = ..., start_date: _Optional[int] = ..., start_date_local: _Optional[int] = ..., timezone: _Optional[str] = ..., start_latlng: _Optional[_Iterable[float]] = ..., end_latlng: _Optional[_Iterable[float]] = ..., achievement_count: _Optional[int] = ..., kudos_count: _Optional[int] = ..., comment_count: _Optional[int] = ..., athlete_count: _Optional[int] = ..., photo_count: _Optional[int] = ..., total_photo_count: _Optional[int] = ..., map: _Optional[_Union[Activity.Map, _Mapping]] = ..., trainer: bool = ..., commute: bool = ..., manual: bool = ..., private: bool = ..., flagged: bool = ..., workout_type: _Optional[str] = ..., upload_id_str: _Optional[str] = ..., average_speed: _Optional[float] = ..., max_speed: _Optional[float] = ..., has_kudoed: bool = ..., hide_from_home: bool = ..., gear_id: _Optional[str] = ..., kilojoules: _Optional[float] = ..., average_watts: _Optional[float] = ..., device_watts: bool = ..., max_watts: _Optional[int] = ..., weighted_average_watts: _Optional[int] = ..., description: _Optional[str] = ..., photos: _Optional[_Union[Activity.Photos, _Mapping]] = ..., gear: _Optional[_Union[Activity.Gear, _Mapping]] = ..., calories: _Optional[float] = ..., segment_efforts: _Optional[_Iterable[_Union[Activity.SegmentEfforts, _Mapping]]] = ..., device_name: _Optional[str] = ..., embed_token: _Optional[str] = ..., splits_metric: _Optional[_Iterable[_Union[Activity.SplitsMetric, _Mapping]]] = ..., splits_standard: _Optional[_Iterable[_Union[Activity.SplitsStandard, _Mapping]]] = ..., laps: _Optional[_Iterable[_Union[Activity.Laps, _Mapping]]] = ..., best_efforts: _Optional[_Iterable[_Union[Activity.BestEfforts, _Mapping]]] = ..., average_cadence: _Optional[float] = ..., has_heartrate: bool = ..., pr_count: _Optional[int] = ..., suffer_score: _Optional[float] = ..., stats_visibility: _Optional[_Iterable[_Union[Activity.StatsVisibility, _Mapping]]] = ..., display_hide_heartrate_option: bool = ..., heartrate_opt_out: bool = ..., average_heartrate: _Optional[float] = ..., max_heartrate: _Optional[float] = ..., available_zones: _Optional[_Iterable[str]] = ..., visibility: _Optional[str] = ...) -> None: ...
