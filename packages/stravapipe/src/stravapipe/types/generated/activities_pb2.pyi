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
    DISTANCE_TRAVELED_FIELD_NUMBER: _ClassVar[int]
    distance_traveled: _containers.RepeatedCompositeFieldContainer[TimeseriesEntry]
    def __init__(
        self, distance_traveled: _Iterable[TimeseriesEntry | _Mapping] | None = ...
    ) -> None: ...
