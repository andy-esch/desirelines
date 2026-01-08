from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar, Iterable, Mapping, Optional, Union

ANNOTATION_TYPE_EVENT: AnnotationType
ANNOTATION_TYPE_NOTE: AnnotationType
ANNOTATION_TYPE_PERIOD: AnnotationType
ANNOTATION_TYPE_UNSPECIFIED: AnnotationType
DESCRIPTOR: _descriptor.FileDescriptor

class Annotation(_message.Message):
    __slots__ = ["created_at", "description", "end_date", "id", "label", "start_date", "strava_activity_id", "type", "updated_at"]
    CREATED_AT_FIELD_NUMBER: ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: ClassVar[int]
    END_DATE_FIELD_NUMBER: ClassVar[int]
    ID_FIELD_NUMBER: ClassVar[int]
    LABEL_FIELD_NUMBER: ClassVar[int]
    START_DATE_FIELD_NUMBER: ClassVar[int]
    STRAVA_ACTIVITY_ID_FIELD_NUMBER: ClassVar[int]
    TYPE_FIELD_NUMBER: ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: ClassVar[int]
    created_at: str
    description: str
    end_date: str
    id: str
    label: str
    start_date: str
    strava_activity_id: str
    type: AnnotationType
    updated_at: str
    def __init__(self, id: Optional[str] = ..., start_date: Optional[str] = ..., end_date: Optional[str] = ..., label: Optional[str] = ..., description: Optional[str] = ..., strava_activity_id: Optional[str] = ..., type: Optional[Union[AnnotationType, str]] = ..., created_at: Optional[str] = ..., updated_at: Optional[str] = ...) -> None: ...

class AnnotationsForYear(_message.Message):
    __slots__ = ["annotations"]
    ANNOTATIONS_FIELD_NUMBER: ClassVar[int]
    annotations: _containers.RepeatedCompositeFieldContainer[Annotation]
    def __init__(self, annotations: Optional[Iterable[Union[Annotation, Mapping]]] = ...) -> None: ...

class ChartDefaults(_message.Message):
    __slots__ = ["show_average", "show_goals"]
    SHOW_AVERAGE_FIELD_NUMBER: ClassVar[int]
    SHOW_GOALS_FIELD_NUMBER: ClassVar[int]
    show_average: bool
    show_goals: bool
    def __init__(self, show_average: bool = ..., show_goals: bool = ...) -> None: ...

class Goal(_message.Message):
    __slots__ = ["created_at", "id", "label", "updated_at", "value"]
    CREATED_AT_FIELD_NUMBER: ClassVar[int]
    ID_FIELD_NUMBER: ClassVar[int]
    LABEL_FIELD_NUMBER: ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: ClassVar[int]
    VALUE_FIELD_NUMBER: ClassVar[int]
    created_at: str
    id: str
    label: str
    updated_at: str
    value: int
    def __init__(self, id: Optional[str] = ..., value: Optional[int] = ..., label: Optional[str] = ..., created_at: Optional[str] = ..., updated_at: Optional[str] = ...) -> None: ...

class GoalsForYear(_message.Message):
    __slots__ = ["goals"]
    GOALS_FIELD_NUMBER: ClassVar[int]
    goals: _containers.RepeatedCompositeFieldContainer[Goal]
    def __init__(self, goals: Optional[Iterable[Union[Goal, Mapping]]] = ...) -> None: ...

class Metadata(_message.Message):
    __slots__ = ["config_types", "created_at", "last_synced_device"]
    CONFIG_TYPES_FIELD_NUMBER: ClassVar[int]
    CREATED_AT_FIELD_NUMBER: ClassVar[int]
    LAST_SYNCED_DEVICE_FIELD_NUMBER: ClassVar[int]
    config_types: _containers.RepeatedScalarFieldContainer[str]
    created_at: str
    last_synced_device: str
    def __init__(self, created_at: Optional[str] = ..., last_synced_device: Optional[str] = ..., config_types: Optional[Iterable[str]] = ...) -> None: ...

class Preferences(_message.Message):
    __slots__ = ["chart_defaults", "default_sport", "default_year", "distance_unit", "elevation_unit", "theme", "timezone"]
    CHART_DEFAULTS_FIELD_NUMBER: ClassVar[int]
    DEFAULT_SPORT_FIELD_NUMBER: ClassVar[int]
    DEFAULT_YEAR_FIELD_NUMBER: ClassVar[int]
    DISTANCE_UNIT_FIELD_NUMBER: ClassVar[int]
    ELEVATION_UNIT_FIELD_NUMBER: ClassVar[int]
    THEME_FIELD_NUMBER: ClassVar[int]
    TIMEZONE_FIELD_NUMBER: ClassVar[int]
    chart_defaults: ChartDefaults
    default_sport: str
    default_year: int
    distance_unit: str
    elevation_unit: str
    theme: str
    timezone: str
    def __init__(self, theme: Optional[str] = ..., default_year: Optional[int] = ..., chart_defaults: Optional[Union[ChartDefaults, Mapping]] = ..., distance_unit: Optional[str] = ..., elevation_unit: Optional[str] = ..., default_sport: Optional[str] = ..., timezone: Optional[str] = ...) -> None: ...

class SportGoalsForYear(_message.Message):
    __slots__ = ["sports"]
    class SportsEntry(_message.Message):
        __slots__ = ["key", "value"]
        KEY_FIELD_NUMBER: ClassVar[int]
        VALUE_FIELD_NUMBER: ClassVar[int]
        key: str
        value: GoalsForYear
        def __init__(self, key: Optional[str] = ..., value: Optional[Union[GoalsForYear, Mapping]] = ...) -> None: ...
    SPORTS_FIELD_NUMBER: ClassVar[int]
    sports: _containers.MessageMap[str, GoalsForYear]
    def __init__(self, sports: Optional[Mapping[str, GoalsForYear]] = ...) -> None: ...

class UserConfig(_message.Message):
    __slots__ = ["annotations", "goals", "last_updated", "metadata", "preferences", "schema_version", "user_id"]
    class AnnotationsEntry(_message.Message):
        __slots__ = ["key", "value"]
        KEY_FIELD_NUMBER: ClassVar[int]
        VALUE_FIELD_NUMBER: ClassVar[int]
        key: str
        value: AnnotationsForYear
        def __init__(self, key: Optional[str] = ..., value: Optional[Union[AnnotationsForYear, Mapping]] = ...) -> None: ...
    class GoalsEntry(_message.Message):
        __slots__ = ["key", "value"]
        KEY_FIELD_NUMBER: ClassVar[int]
        VALUE_FIELD_NUMBER: ClassVar[int]
        key: str
        value: SportGoalsForYear
        def __init__(self, key: Optional[str] = ..., value: Optional[Union[SportGoalsForYear, Mapping]] = ...) -> None: ...
    ANNOTATIONS_FIELD_NUMBER: ClassVar[int]
    GOALS_FIELD_NUMBER: ClassVar[int]
    LAST_UPDATED_FIELD_NUMBER: ClassVar[int]
    METADATA_FIELD_NUMBER: ClassVar[int]
    PREFERENCES_FIELD_NUMBER: ClassVar[int]
    SCHEMA_VERSION_FIELD_NUMBER: ClassVar[int]
    USER_ID_FIELD_NUMBER: ClassVar[int]
    annotations: _containers.MessageMap[str, AnnotationsForYear]
    goals: _containers.MessageMap[str, SportGoalsForYear]
    last_updated: str
    metadata: Metadata
    preferences: Preferences
    schema_version: str
    user_id: str
    def __init__(self, schema_version: Optional[str] = ..., user_id: Optional[str] = ..., last_updated: Optional[str] = ..., goals: Optional[Mapping[str, SportGoalsForYear]] = ..., annotations: Optional[Mapping[str, AnnotationsForYear]] = ..., preferences: Optional[Union[Preferences, Mapping]] = ..., metadata: Optional[Union[Metadata, Mapping]] = ...) -> None: ...

class AnnotationType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = []
