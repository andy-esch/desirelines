from collections.abc import Iterable as _Iterable
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar

from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor

class TimeseriesEntry(_message.Message):
    __slots__ = ()
    DATE_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    date: str
    value: float
    def __init__(self, date: str | None = ..., value: float | None = ...) -> None: ...

class DistancesPayload(_message.Message):
    __slots__ = ()
    class SummariesEntry(_message.Message):
        __slots__ = ()
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: DailySummary
        def __init__(
            self, key: str | None = ..., value: DailySummary | _Mapping | None = ...
        ) -> None: ...

    DISTANCE_TRAVELED_FIELD_NUMBER: _ClassVar[int]
    AVG_DISTANCE_FIELD_NUMBER: _ClassVar[int]
    LOWER_DISTANCE_FIELD_NUMBER: _ClassVar[int]
    UPPER_DISTANCE_FIELD_NUMBER: _ClassVar[int]
    SUMMARIES_FIELD_NUMBER: _ClassVar[int]
    distance_traveled: _containers.RepeatedCompositeFieldContainer[TimeseriesEntry]
    avg_distance: _containers.RepeatedCompositeFieldContainer[TimeseriesEntry]
    lower_distance: _containers.RepeatedCompositeFieldContainer[TimeseriesEntry]
    upper_distance: _containers.RepeatedCompositeFieldContainer[TimeseriesEntry]
    summaries: _containers.MessageMap[str, DailySummary]
    def __init__(
        self,
        distance_traveled: _Iterable[TimeseriesEntry | _Mapping] | None = ...,
        avg_distance: _Iterable[TimeseriesEntry | _Mapping] | None = ...,
        lower_distance: _Iterable[TimeseriesEntry | _Mapping] | None = ...,
        upper_distance: _Iterable[TimeseriesEntry | _Mapping] | None = ...,
        summaries: _Mapping[str, DailySummary] | None = ...,
    ) -> None: ...

class DailySummary(_message.Message):
    __slots__ = ()
    ACTIVITY_IDS_FIELD_NUMBER: _ClassVar[int]
    DISTANCE_MILES_FIELD_NUMBER: _ClassVar[int]
    activity_ids: _containers.RepeatedScalarFieldContainer[str]
    distance_miles: float
    def __init__(
        self,
        activity_ids: _Iterable[str] | None = ...,
        distance_miles: float | None = ...,
    ) -> None: ...

class YearSummary(_message.Message):
    __slots__ = ()
    class DailySummariesEntry(_message.Message):
        __slots__ = ()
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: DailySummary
        def __init__(
            self, key: str | None = ..., value: DailySummary | _Mapping | None = ...
        ) -> None: ...

    DAILY_SUMMARIES_FIELD_NUMBER: _ClassVar[int]
    daily_summaries: _containers.MessageMap[str, DailySummary]
    def __init__(
        self, daily_summaries: _Mapping[str, DailySummary] | None = ...
    ) -> None: ...
