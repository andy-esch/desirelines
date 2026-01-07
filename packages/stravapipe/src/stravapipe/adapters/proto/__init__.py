"""Protocol buffer adapters for stravapipe."""

from stravapipe.adapters.proto.webhook_adapter import (
    dict_to_webhook_event,
    proto_to_dict,
    proto_to_pydantic,
    pydantic_to_proto,
    validate_webhook_event,
)

__all__ = [
    "dict_to_webhook_event",
    "proto_to_dict",
    "proto_to_pydantic",
    "pydantic_to_proto",
    "validate_webhook_event",
]
