from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TimeseriesEntry(_message.Message):
    __slots__ = ()
    DATE_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    date: str
    value: float
    def __init__(self, date: _Optional[str] = ..., value: _Optional[float] = ...) -> None: ...

class DailyActivity(_message.Message):
    __slots__ = ()
    DISTANCE_METERS_FIELD_NUMBER: _ClassVar[int]
    TIME_MINUTES_FIELD_NUMBER: _ClassVar[int]
    ELEVATION_METERS_FIELD_NUMBER: _ClassVar[int]
    ACTIVITIES_FIELD_NUMBER: _ClassVar[int]
    ACTIVITY_IDS_FIELD_NUMBER: _ClassVar[int]
    distance_meters: float
    time_minutes: float
    elevation_meters: float
    activities: int
    activity_ids: _containers.RepeatedScalarFieldContainer[int]
    def __init__(self, distance_meters: _Optional[float] = ..., time_minutes: _Optional[float] = ..., elevation_meters: _Optional[float] = ..., activities: _Optional[int] = ..., activity_ids: _Optional[_Iterable[int]] = ...) -> None: ...

class MetricsTimeseries(_message.Message):
    __slots__ = ()
    DISTANCE_METERS_FIELD_NUMBER: _ClassVar[int]
    TIME_MINUTES_FIELD_NUMBER: _ClassVar[int]
    ELEVATION_METERS_FIELD_NUMBER: _ClassVar[int]
    distance_meters: _containers.RepeatedCompositeFieldContainer[TimeseriesEntry]
    time_minutes: _containers.RepeatedCompositeFieldContainer[TimeseriesEntry]
    elevation_meters: _containers.RepeatedCompositeFieldContainer[TimeseriesEntry]
    def __init__(self, distance_meters: _Optional[_Iterable[_Union[TimeseriesEntry, _Mapping]]] = ..., time_minutes: _Optional[_Iterable[_Union[TimeseriesEntry, _Mapping]]] = ..., elevation_meters: _Optional[_Iterable[_Union[TimeseriesEntry, _Mapping]]] = ...) -> None: ...

class SportMetrics(_message.Message):
    __slots__ = ()
    class DailyEntry(_message.Message):
        __slots__ = ()
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: DailyActivity
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[DailyActivity, _Mapping]] = ...) -> None: ...
    TIMESERIES_FIELD_NUMBER: _ClassVar[int]
    DAILY_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    timeseries: MetricsTimeseries
    daily: _containers.MessageMap[str, DailyActivity]
    metadata: SportMetadata
    def __init__(self, timeseries: _Optional[_Union[MetricsTimeseries, _Mapping]] = ..., daily: _Optional[_Mapping[str, DailyActivity]] = ..., metadata: _Optional[_Union[SportMetadata, _Mapping]] = ...) -> None: ...

class SportMetadata(_message.Message):
    __slots__ = ()
    SPORT_FIELD_NUMBER: _ClassVar[int]
    YEAR_FIELD_NUMBER: _ClassVar[int]
    AVAILABLE_METRICS_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_METRIC_FIELD_NUMBER: _ClassVar[int]
    sport: str
    year: int
    available_metrics: _containers.RepeatedScalarFieldContainer[str]
    primary_metric: str
    def __init__(self, sport: _Optional[str] = ..., year: _Optional[int] = ..., available_metrics: _Optional[_Iterable[str]] = ..., primary_metric: _Optional[str] = ...) -> None: ...

class SportTotals(_message.Message):
    __slots__ = ()
    DISTANCE_METERS_FIELD_NUMBER: _ClassVar[int]
    TIME_MINUTES_FIELD_NUMBER: _ClassVar[int]
    ELEVATION_METERS_FIELD_NUMBER: _ClassVar[int]
    ACTIVITIES_FIELD_NUMBER: _ClassVar[int]
    distance_meters: float
    time_minutes: float
    elevation_meters: float
    activities: int
    def __init__(self, distance_meters: _Optional[float] = ..., time_minutes: _Optional[float] = ..., elevation_meters: _Optional[float] = ..., activities: _Optional[int] = ...) -> None: ...

class YearMetadata(_message.Message):
    __slots__ = ()
    class TotalsEntry(_message.Message):
        __slots__ = ()
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: SportTotals
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[SportTotals, _Mapping]] = ...) -> None: ...
    YEAR_FIELD_NUMBER: _ClassVar[int]
    SPORTS_FIELD_NUMBER: _ClassVar[int]
    TOTALS_FIELD_NUMBER: _ClassVar[int]
    LAST_UPDATED_FIELD_NUMBER: _ClassVar[int]
    AGGREGATION_VERSION_FIELD_NUMBER: _ClassVar[int]
    year: int
    sports: _containers.RepeatedScalarFieldContainer[str]
    totals: _containers.MessageMap[str, SportTotals]
    last_updated: str
    aggregation_version: str
    def __init__(self, year: _Optional[int] = ..., sports: _Optional[_Iterable[str]] = ..., totals: _Optional[_Mapping[str, SportTotals]] = ..., last_updated: _Optional[str] = ..., aggregation_version: _Optional[str] = ...) -> None: ...
