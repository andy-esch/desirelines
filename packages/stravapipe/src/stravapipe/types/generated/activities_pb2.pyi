from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar, Iterable, Mapping, Optional, Union

DESCRIPTOR: _descriptor.FileDescriptor

class DistancesPayload(_message.Message):
    __slots__ = ["distance_traveled"]
    DISTANCE_TRAVELED_FIELD_NUMBER: ClassVar[int]
    distance_traveled: _containers.RepeatedCompositeFieldContainer[TimeseriesEntry]
    def __init__(self, distance_traveled: Optional[Iterable[Union[TimeseriesEntry, Mapping]]] = ...) -> None: ...

class TimeseriesEntry(_message.Message):
    __slots__ = ["date", "value"]
    DATE_FIELD_NUMBER: ClassVar[int]
    VALUE_FIELD_NUMBER: ClassVar[int]
    date: str
    value: float
    def __init__(self, date: Optional[str] = ..., value: Optional[float] = ...) -> None: ...
