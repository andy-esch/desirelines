from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar, Iterable, Mapping, Optional, Union

DESCRIPTOR: _descriptor.FileDescriptor
METRIC_TYPE_ACTIVITIES: MetricType
METRIC_TYPE_DISTANCE_METERS: MetricType
METRIC_TYPE_ELEVATION_METERS: MetricType
METRIC_TYPE_TIME_MINUTES: MetricType
METRIC_TYPE_UNSPECIFIED: MetricType

class AllSportsDailySummary(_message.Message):
    __slots__ = ["by_sport"]
    class BySportEntry(_message.Message):
        __slots__ = ["key", "value"]
        KEY_FIELD_NUMBER: ClassVar[int]
        VALUE_FIELD_NUMBER: ClassVar[int]
        key: str
        value: DailySummary
        def __init__(self, key: Optional[str] = ..., value: Optional[Union[DailySummary, Mapping]] = ...) -> None: ...
    BY_SPORT_FIELD_NUMBER: ClassVar[int]
    by_sport: _containers.MessageMap[str, DailySummary]
    def __init__(self, by_sport: Optional[Mapping[str, DailySummary]] = ...) -> None: ...

class AllSportsMetrics(_message.Message):
    __slots__ = ["by_sport"]
    class BySportEntry(_message.Message):
        __slots__ = ["key", "value"]
        KEY_FIELD_NUMBER: ClassVar[int]
        VALUE_FIELD_NUMBER: ClassVar[int]
        key: str
        value: SportMetrics
        def __init__(self, key: Optional[str] = ..., value: Optional[Union[SportMetrics, Mapping]] = ...) -> None: ...
    BY_SPORT_FIELD_NUMBER: ClassVar[int]
    by_sport: _containers.MessageMap[str, SportMetrics]
    def __init__(self, by_sport: Optional[Mapping[str, SportMetrics]] = ...) -> None: ...

class CumulativeMetricsEntry(_message.Message):
    __slots__ = ["activities", "date", "distance", "elevation", "time"]
    ACTIVITIES_FIELD_NUMBER: ClassVar[int]
    DATE_FIELD_NUMBER: ClassVar[int]
    DISTANCE_FIELD_NUMBER: ClassVar[int]
    ELEVATION_FIELD_NUMBER: ClassVar[int]
    TIME_FIELD_NUMBER: ClassVar[int]
    activities: int
    date: str
    distance: float
    elevation: float
    time: float
    def __init__(self, date: Optional[str] = ..., distance: Optional[float] = ..., elevation: Optional[float] = ..., time: Optional[float] = ..., activities: Optional[int] = ...) -> None: ...

class DailyActivity(_message.Message):
    __slots__ = ["activities", "activity_ids", "distance_meters", "elevation_meters", "time_minutes"]
    ACTIVITIES_FIELD_NUMBER: ClassVar[int]
    ACTIVITY_IDS_FIELD_NUMBER: ClassVar[int]
    DISTANCE_METERS_FIELD_NUMBER: ClassVar[int]
    ELEVATION_METERS_FIELD_NUMBER: ClassVar[int]
    TIME_MINUTES_FIELD_NUMBER: ClassVar[int]
    activities: int
    activity_ids: _containers.RepeatedScalarFieldContainer[int]
    distance_meters: float
    elevation_meters: float
    time_minutes: float
    def __init__(self, distance_meters: Optional[float] = ..., time_minutes: Optional[float] = ..., elevation_meters: Optional[float] = ..., activities: Optional[int] = ..., activity_ids: Optional[Iterable[int]] = ...) -> None: ...

class DailySummary(_message.Message):
    __slots__ = ["daily"]
    class DailyEntry(_message.Message):
        __slots__ = ["key", "value"]
        KEY_FIELD_NUMBER: ClassVar[int]
        VALUE_FIELD_NUMBER: ClassVar[int]
        key: str
        value: DailyActivity
        def __init__(self, key: Optional[str] = ..., value: Optional[Union[DailyActivity, Mapping]] = ...) -> None: ...
    DAILY_FIELD_NUMBER: ClassVar[int]
    daily: _containers.MessageMap[str, DailyActivity]
    def __init__(self, daily: Optional[Mapping[str, DailyActivity]] = ...) -> None: ...

class MetricTimeseriesEntry(_message.Message):
    __slots__ = ["date", "value"]
    DATE_FIELD_NUMBER: ClassVar[int]
    VALUE_FIELD_NUMBER: ClassVar[int]
    date: str
    value: float
    def __init__(self, date: Optional[str] = ..., value: Optional[float] = ...) -> None: ...

class SportMetadata(_message.Message):
    __slots__ = ["available_metrics", "primary_metric", "sport", "year"]
    AVAILABLE_METRICS_FIELD_NUMBER: ClassVar[int]
    PRIMARY_METRIC_FIELD_NUMBER: ClassVar[int]
    SPORT_FIELD_NUMBER: ClassVar[int]
    YEAR_FIELD_NUMBER: ClassVar[int]
    available_metrics: _containers.RepeatedScalarFieldContainer[str]
    primary_metric: str
    sport: str
    year: int
    def __init__(self, sport: Optional[str] = ..., year: Optional[int] = ..., available_metrics: Optional[Iterable[str]] = ..., primary_metric: Optional[str] = ...) -> None: ...

class SportMetrics(_message.Message):
    __slots__ = ["timeseries"]
    TIMESERIES_FIELD_NUMBER: ClassVar[int]
    timeseries: _containers.RepeatedCompositeFieldContainer[CumulativeMetricsEntry]
    def __init__(self, timeseries: Optional[Iterable[Union[CumulativeMetricsEntry, Mapping]]] = ...) -> None: ...

class SportTotals(_message.Message):
    __slots__ = ["activities", "distance_meters", "elevation_meters", "time_minutes"]
    ACTIVITIES_FIELD_NUMBER: ClassVar[int]
    DISTANCE_METERS_FIELD_NUMBER: ClassVar[int]
    ELEVATION_METERS_FIELD_NUMBER: ClassVar[int]
    TIME_MINUTES_FIELD_NUMBER: ClassVar[int]
    activities: int
    distance_meters: float
    elevation_meters: float
    time_minutes: float
    def __init__(self, distance_meters: Optional[float] = ..., time_minutes: Optional[float] = ..., elevation_meters: Optional[float] = ..., activities: Optional[int] = ...) -> None: ...

class YearMetadata(_message.Message):
    __slots__ = ["aggregation_version", "last_updated", "sports", "totals", "year"]
    class TotalsEntry(_message.Message):
        __slots__ = ["key", "value"]
        KEY_FIELD_NUMBER: ClassVar[int]
        VALUE_FIELD_NUMBER: ClassVar[int]
        key: str
        value: SportTotals
        def __init__(self, key: Optional[str] = ..., value: Optional[Union[SportTotals, Mapping]] = ...) -> None: ...
    AGGREGATION_VERSION_FIELD_NUMBER: ClassVar[int]
    LAST_UPDATED_FIELD_NUMBER: ClassVar[int]
    SPORTS_FIELD_NUMBER: ClassVar[int]
    TOTALS_FIELD_NUMBER: ClassVar[int]
    YEAR_FIELD_NUMBER: ClassVar[int]
    aggregation_version: str
    last_updated: str
    sports: _containers.RepeatedScalarFieldContainer[str]
    totals: _containers.MessageMap[str, SportTotals]
    year: int
    def __init__(self, year: Optional[int] = ..., sports: Optional[Iterable[str]] = ..., totals: Optional[Mapping[str, SportTotals]] = ..., last_updated: Optional[str] = ..., aggregation_version: Optional[str] = ...) -> None: ...

class MetricType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = []
