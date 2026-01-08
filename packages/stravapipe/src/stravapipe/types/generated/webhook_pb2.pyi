from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar, Mapping, Optional, Union

ASPECT_TYPE_CREATE: AspectType
ASPECT_TYPE_DELETE: AspectType
ASPECT_TYPE_UNSPECIFIED: AspectType
ASPECT_TYPE_UPDATE: AspectType
DESCRIPTOR: _descriptor.FileDescriptor
OBJECT_TYPE_ACTIVITY: ObjectType
OBJECT_TYPE_ATHLETE: ObjectType
OBJECT_TYPE_UNSPECIFIED: ObjectType

class WebhookEvent(_message.Message):
    __slots__ = ["aspect_type", "event_time", "object_id", "object_type", "owner_id", "subscription_id", "updates"]
    class UpdatesEntry(_message.Message):
        __slots__ = ["key", "value"]
        KEY_FIELD_NUMBER: ClassVar[int]
        VALUE_FIELD_NUMBER: ClassVar[int]
        key: str
        value: str
        def __init__(self, key: Optional[str] = ..., value: Optional[str] = ...) -> None: ...
    ASPECT_TYPE_FIELD_NUMBER: ClassVar[int]
    EVENT_TIME_FIELD_NUMBER: ClassVar[int]
    OBJECT_ID_FIELD_NUMBER: ClassVar[int]
    OBJECT_TYPE_FIELD_NUMBER: ClassVar[int]
    OWNER_ID_FIELD_NUMBER: ClassVar[int]
    SUBSCRIPTION_ID_FIELD_NUMBER: ClassVar[int]
    UPDATES_FIELD_NUMBER: ClassVar[int]
    aspect_type: AspectType
    event_time: int
    object_id: int
    object_type: ObjectType
    owner_id: int
    subscription_id: int
    updates: _containers.ScalarMap[str, str]
    def __init__(self, aspect_type: Optional[Union[AspectType, str]] = ..., object_type: Optional[Union[ObjectType, str]] = ..., object_id: Optional[int] = ..., owner_id: Optional[int] = ..., event_time: Optional[int] = ..., subscription_id: Optional[int] = ..., updates: Optional[Mapping[str, str]] = ...) -> None: ...

class WebhookVerificationRequest(_message.Message):
    __slots__ = ["hub_challenge", "hub_mode", "hub_verify_token"]
    HUB_CHALLENGE_FIELD_NUMBER: ClassVar[int]
    HUB_MODE_FIELD_NUMBER: ClassVar[int]
    HUB_VERIFY_TOKEN_FIELD_NUMBER: ClassVar[int]
    hub_challenge: str
    hub_mode: str
    hub_verify_token: str
    def __init__(self, hub_mode: Optional[str] = ..., hub_challenge: Optional[str] = ..., hub_verify_token: Optional[str] = ...) -> None: ...

class WebhookVerificationResponse(_message.Message):
    __slots__ = ["hub_challenge"]
    HUB_CHALLENGE_FIELD_NUMBER: ClassVar[int]
    hub_challenge: str
    def __init__(self, hub_challenge: Optional[str] = ...) -> None: ...

class AspectType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = []

class ObjectType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = []
