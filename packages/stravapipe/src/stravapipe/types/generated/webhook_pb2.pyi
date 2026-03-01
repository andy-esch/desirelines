from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AspectType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ASPECT_TYPE_UNSPECIFIED: _ClassVar[AspectType]
    ASPECT_TYPE_CREATE: _ClassVar[AspectType]
    ASPECT_TYPE_UPDATE: _ClassVar[AspectType]
    ASPECT_TYPE_DELETE: _ClassVar[AspectType]

class ObjectType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    OBJECT_TYPE_UNSPECIFIED: _ClassVar[ObjectType]
    OBJECT_TYPE_ACTIVITY: _ClassVar[ObjectType]
    OBJECT_TYPE_ATHLETE: _ClassVar[ObjectType]
ASPECT_TYPE_UNSPECIFIED: AspectType
ASPECT_TYPE_CREATE: AspectType
ASPECT_TYPE_UPDATE: AspectType
ASPECT_TYPE_DELETE: AspectType
OBJECT_TYPE_UNSPECIFIED: ObjectType
OBJECT_TYPE_ACTIVITY: ObjectType
OBJECT_TYPE_ATHLETE: ObjectType

class ActivityUpdates(_message.Message):
    __slots__ = ("title", "type", "private")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    PRIVATE_FIELD_NUMBER: _ClassVar[int]
    title: str
    type: str
    private: bool
    def __init__(self, title: _Optional[str] = ..., type: _Optional[str] = ..., private: bool = ...) -> None: ...

class WebhookEvent(_message.Message):
    __slots__ = ("aspect_type", "object_type", "object_id", "owner_id", "event_time", "subscription_id", "updates")
    ASPECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    OBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    OBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_TIME_FIELD_NUMBER: _ClassVar[int]
    SUBSCRIPTION_ID_FIELD_NUMBER: _ClassVar[int]
    UPDATES_FIELD_NUMBER: _ClassVar[int]
    aspect_type: AspectType
    object_type: ObjectType
    object_id: int
    owner_id: int
    event_time: int
    subscription_id: int
    updates: ActivityUpdates
    def __init__(self, aspect_type: _Optional[_Union[AspectType, str]] = ..., object_type: _Optional[_Union[ObjectType, str]] = ..., object_id: _Optional[int] = ..., owner_id: _Optional[int] = ..., event_time: _Optional[int] = ..., subscription_id: _Optional[int] = ..., updates: _Optional[_Union[ActivityUpdates, _Mapping]] = ...) -> None: ...

class EnrichedEvent(_message.Message):
    __slots__ = ("event", "raw_activity")
    EVENT_FIELD_NUMBER: _ClassVar[int]
    RAW_ACTIVITY_FIELD_NUMBER: _ClassVar[int]
    event: WebhookEvent
    raw_activity: bytes
    def __init__(self, event: _Optional[_Union[WebhookEvent, _Mapping]] = ..., raw_activity: _Optional[bytes] = ...) -> None: ...

class WebhookVerificationRequest(_message.Message):
    __slots__ = ("hub_mode", "hub_challenge", "hub_verify_token")
    HUB_MODE_FIELD_NUMBER: _ClassVar[int]
    HUB_CHALLENGE_FIELD_NUMBER: _ClassVar[int]
    HUB_VERIFY_TOKEN_FIELD_NUMBER: _ClassVar[int]
    hub_mode: str
    hub_challenge: str
    hub_verify_token: str
    def __init__(self, hub_mode: _Optional[str] = ..., hub_challenge: _Optional[str] = ..., hub_verify_token: _Optional[str] = ...) -> None: ...

class WebhookVerificationResponse(_message.Message):
    __slots__ = ("hub_challenge",)
    HUB_CHALLENGE_FIELD_NUMBER: _ClassVar[int]
    hub_challenge: str
    def __init__(self, hub_challenge: _Optional[str] = ...) -> None: ...
