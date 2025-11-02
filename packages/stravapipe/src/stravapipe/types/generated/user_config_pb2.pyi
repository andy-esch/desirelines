from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AnnotationType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ANNOTATION_TYPE_UNSPECIFIED: _ClassVar[AnnotationType]
    ANNOTATION_TYPE_EVENT: _ClassVar[AnnotationType]
    ANNOTATION_TYPE_PERIOD: _ClassVar[AnnotationType]
    ANNOTATION_TYPE_NOTE: _ClassVar[AnnotationType]
ANNOTATION_TYPE_UNSPECIFIED: AnnotationType
ANNOTATION_TYPE_EVENT: AnnotationType
ANNOTATION_TYPE_PERIOD: AnnotationType
ANNOTATION_TYPE_NOTE: AnnotationType

class UserConfig(_message.Message):
    __slots__ = ()
    class GoalsEntry(_message.Message):
        __slots__ = ()
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: GoalsForYear
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[GoalsForYear, _Mapping]] = ...) -> None: ...
    class AnnotationsEntry(_message.Message):
        __slots__ = ()
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: AnnotationsForYear
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[AnnotationsForYear, _Mapping]] = ...) -> None: ...
    SCHEMA_VERSION_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    LAST_UPDATED_FIELD_NUMBER: _ClassVar[int]
    GOALS_FIELD_NUMBER: _ClassVar[int]
    ANNOTATIONS_FIELD_NUMBER: _ClassVar[int]
    PREFERENCES_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    schema_version: str
    user_id: str
    last_updated: str
    goals: _containers.MessageMap[str, GoalsForYear]
    annotations: _containers.MessageMap[str, AnnotationsForYear]
    preferences: Preferences
    metadata: Metadata
    def __init__(self, schema_version: _Optional[str] = ..., user_id: _Optional[str] = ..., last_updated: _Optional[str] = ..., goals: _Optional[_Mapping[str, GoalsForYear]] = ..., annotations: _Optional[_Mapping[str, AnnotationsForYear]] = ..., preferences: _Optional[_Union[Preferences, _Mapping]] = ..., metadata: _Optional[_Union[Metadata, _Mapping]] = ...) -> None: ...

class GoalsForYear(_message.Message):
    __slots__ = ()
    GOALS_FIELD_NUMBER: _ClassVar[int]
    goals: _containers.RepeatedCompositeFieldContainer[Goal]
    def __init__(self, goals: _Optional[_Iterable[_Union[Goal, _Mapping]]] = ...) -> None: ...

class Goal(_message.Message):
    __slots__ = ()
    ID_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    value: int
    label: str
    created_at: str
    updated_at: str
    def __init__(self, id: _Optional[str] = ..., value: _Optional[int] = ..., label: _Optional[str] = ..., created_at: _Optional[str] = ..., updated_at: _Optional[str] = ...) -> None: ...

class AnnotationsForYear(_message.Message):
    __slots__ = ()
    ANNOTATIONS_FIELD_NUMBER: _ClassVar[int]
    annotations: _containers.RepeatedCompositeFieldContainer[Annotation]
    def __init__(self, annotations: _Optional[_Iterable[_Union[Annotation, _Mapping]]] = ...) -> None: ...

class Annotation(_message.Message):
    __slots__ = ()
    ID_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    END_DATE_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    STRAVA_ACTIVITY_ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    start_date: str
    end_date: str
    label: str
    description: str
    strava_activity_id: str
    type: AnnotationType
    created_at: str
    updated_at: str
    def __init__(self, id: _Optional[str] = ..., start_date: _Optional[str] = ..., end_date: _Optional[str] = ..., label: _Optional[str] = ..., description: _Optional[str] = ..., strava_activity_id: _Optional[str] = ..., type: _Optional[_Union[AnnotationType, str]] = ..., created_at: _Optional[str] = ..., updated_at: _Optional[str] = ...) -> None: ...

class Preferences(_message.Message):
    __slots__ = ()
    THEME_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_YEAR_FIELD_NUMBER: _ClassVar[int]
    CHART_DEFAULTS_FIELD_NUMBER: _ClassVar[int]
    theme: str
    default_year: int
    chart_defaults: ChartDefaults
    def __init__(self, theme: _Optional[str] = ..., default_year: _Optional[int] = ..., chart_defaults: _Optional[_Union[ChartDefaults, _Mapping]] = ...) -> None: ...

class ChartDefaults(_message.Message):
    __slots__ = ()
    SHOW_AVERAGE_FIELD_NUMBER: _ClassVar[int]
    SHOW_GOALS_FIELD_NUMBER: _ClassVar[int]
    show_average: bool
    show_goals: bool
    def __init__(self, show_average: _Optional[bool] = ..., show_goals: _Optional[bool] = ...) -> None: ...

class Metadata(_message.Message):
    __slots__ = ()
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_SYNCED_DEVICE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_TYPES_FIELD_NUMBER: _ClassVar[int]
    created_at: str
    last_synced_device: str
    config_types: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, created_at: _Optional[str] = ..., last_synced_device: _Optional[str] = ..., config_types: _Optional[_Iterable[str]] = ...) -> None: ...
