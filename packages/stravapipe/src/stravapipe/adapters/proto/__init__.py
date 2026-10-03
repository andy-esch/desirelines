"""Protocol buffer adapters for stravapipe."""

from stravapipe.adapters.proto.webhook_adapter import (
    dict_to_webhook_event,
    proto_to_dict,
)

__all__ = [
    "dict_to_webhook_event",
    "proto_to_dict",
]
