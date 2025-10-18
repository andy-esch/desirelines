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
    Strava WebHook documentation: https://developers.strava.com/docs/webhooks/
    """

    aspect_type: Annotated[
        AspectType, Field(description="Always 'create,' 'update,' or 'delete.'")
    ]
    event_time: Annotated[int, Field(description="The time that the event occurred.")]
    object_id: Annotated[
        int,
        Field(
            description="For activity events, the activity's ID. For athlete events, the athlete's ID."
        ),
    ]
    object_type: Annotated[
        str, Field(max_length=50, description="Always either 'activity' or 'athlete.'")
    ]
    owner_id: Annotated[int, Field(description="The athlete's ID.")]
    subscription_id: int = Field(
        description="The push subscription ID that is receiving this event."
    )
    updates: Annotated[
        dict,
        Field(
            default_factory=dict,
            description="For activity update events, keys can contain 'title,' 'type,' and 'private,' which is always 'true' (activity visibility set to Only You) or 'false' (activity visibility set to Followers Only or Everyone). For app deauthorization events, there is always an 'authorized' : 'false' key-value pair.",
        ),
    ]

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
