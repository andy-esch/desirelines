from collections.abc import Iterable as _Iterable
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar

from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor

class MetricTimeseriesEntry(_message.Message):
    __slots__ = ()
    DATE_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    date: str
    value: float
    def __init__(self, date: str | None = ..., value: float | None = ...) -> None: ...

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
    def __init__(
        self,
        distance_meters: float | None = ...,
        time_minutes: float | None = ...,
        elevation_meters: float | None = ...,
        activities: int | None = ...,
        activity_ids: _Iterable[int] | None = ...,
    ) -> None: ...

class DailySummary(_message.Message):
    __slots__ = ()
    class DailyEntry(_message.Message):
        __slots__ = ()
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: DailyActivity
        def __init__(
            self, key: str | None = ..., value: DailyActivity | _Mapping | None = ...
        ) -> None: ...

    DAILY_FIELD_NUMBER: _ClassVar[int]
    daily: _containers.MessageMap[str, DailyActivity]
    def __init__(self, daily: _Mapping[str, DailyActivity] | None = ...) -> None: ...

class MetricsTimeseries(_message.Message):
    __slots__ = ()
    DISTANCE_METERS_FIELD_NUMBER: _ClassVar[int]
    TIME_MINUTES_FIELD_NUMBER: _ClassVar[int]
    ELEVATION_METERS_FIELD_NUMBER: _ClassVar[int]
    distance_meters: _containers.RepeatedCompositeFieldContainer[MetricTimeseriesEntry]
    time_minutes: _containers.RepeatedCompositeFieldContainer[MetricTimeseriesEntry]
    elevation_meters: _containers.RepeatedCompositeFieldContainer[MetricTimeseriesEntry]
    def __init__(
        self,
        distance_meters: _Iterable[MetricTimeseriesEntry | _Mapping] | None = ...,
        time_minutes: _Iterable[MetricTimeseriesEntry | _Mapping] | None = ...,
        elevation_meters: _Iterable[MetricTimeseriesEntry | _Mapping] | None = ...,
    ) -> None: ...

class SportMetrics(_message.Message):
    __slots__ = ()
    class DailyEntry(_message.Message):
        __slots__ = ()
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: DailyActivity
        def __init__(
            self, key: str | None = ..., value: DailyActivity | _Mapping | None = ...
        ) -> None: ...

    TIMESERIES_FIELD_NUMBER: _ClassVar[int]
    DAILY_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    timeseries: MetricsTimeseries
    daily: _containers.MessageMap[str, DailyActivity]
    metadata: SportMetadata
    def __init__(
        self,
        timeseries: MetricsTimeseries | _Mapping | None = ...,
        daily: _Mapping[str, DailyActivity] | None = ...,
        metadata: SportMetadata | _Mapping | None = ...,
    ) -> None: ...

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
    def __init__(
        self,
        sport: str | None = ...,
        year: int | None = ...,
        available_metrics: _Iterable[str] | None = ...,
        primary_metric: str | None = ...,
    ) -> None: ...

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
    def __init__(
        self,
        distance_meters: float | None = ...,
        time_minutes: float | None = ...,
        elevation_meters: float | None = ...,
        activities: int | None = ...,
    ) -> None: ...

class YearMetadata(_message.Message):
    __slots__ = ()
    class TotalsEntry(_message.Message):
        __slots__ = ()
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: SportTotals
        def __init__(
            self, key: str | None = ..., value: SportTotals | _Mapping | None = ...
        ) -> None: ...

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
    def __init__(
        self,
        year: int | None = ...,
        sports: _Iterable[str] | None = ...,
        totals: _Mapping[str, SportTotals] | None = ...,
        last_updated: str | None = ...,
        aggregation_version: str | None = ...,
    ) -> None: ...
