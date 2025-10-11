"""Strava webhook domain models."""

from enum import Enum
from typing import Annotated

from pydantic import BaseModel, Field, field_validator


class AspectType(str, Enum):
    """Strava webhook aspect types.

    Represents the type of change that occurred to trigger a webhook event.
    """

    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"


class WebhookRequest(BaseModel):
    """Strava webhook request payload.

    Validates incoming webhook data to protect against malformed or malicious requests.
    """

    aspect_type: Annotated[AspectType, Field(description="Webhook aspect type")]
    event_time: int
    object_id: int
    object_type: Annotated[
        str, Field(max_length=50, description="Object type being updated")
    ]
    owner_id: int
    subscription_id: int
    updates: Annotated[dict, Field(default_factory=dict, description="Update details")]

    @field_validator("object_type")
    @classmethod
    def validate_object_type(cls, v):
        # We only handle activity webhooks
        if v != "activity":
            raise ValueError(
                f"Unsupported object_type: {v}. Only 'activity' is supported"
            )
        return v

    @field_validator("updates")
    @classmethod
    def validate_updates_size(cls, v):
        """Validate updates field size as defensive programming.

        Even though we don't process the updates field, we validate its size
        to protect against malformed or malicious webhook data that could
        consume excessive memory or cause issues in logging/debugging.

        Strava's actual updates are typically small (< 100 chars), so 2000
        is a reasonable safety limit.
        """
        serialized = str(v)
        if len(serialized) > 2000:
            raise ValueError(
                f"Updates field too large: {len(serialized)} chars (max 2000)"
            )
        return v
