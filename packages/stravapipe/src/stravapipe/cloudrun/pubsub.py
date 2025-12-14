"""Pub/Sub CloudEvent handling for Cloud Run services.

Eventarc delivers CloudEvents as HTTP POST requests with:
- CloudEvent metadata in ce-* headers
- Pub/Sub message payload in JSON body

This module provides utilities to parse these requests in FastAPI handlers.
"""

import base64
from dataclasses import dataclass
import json
from typing import Any

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field, ValidationError


class PubSubMessage(BaseModel):
    """Pub/Sub message structure from Eventarc."""

    model_config = {"populate_by_name": True}

    data: str  # base64 encoded
    message_id: str = Field(alias="messageId")
    publish_time: str = Field(alias="publishTime")


class PubSubEnvelope(BaseModel):
    """Envelope containing Pub/Sub message."""

    message: PubSubMessage


@dataclass
class CloudEventContext:
    """CloudEvent metadata from headers."""

    event_type: str
    event_id: str
    source: str
    time: str | None = None


async def parse_pubsub_cloudevent(
    request: Request,
) -> tuple[CloudEventContext, dict[str, Any]]:
    """Parse CloudEvent from Eventarc Pub/Sub trigger.

    Args:
        request: FastAPI request object

    Returns:
        Tuple of (CloudEventContext, decoded message data as dict)

    Raises:
        HTTPException: If parsing fails (400) or validation fails (422)
    """
    # Extract CloudEvent headers
    ce_type = request.headers.get("ce-type")
    ce_id = request.headers.get("ce-id")
    ce_source = request.headers.get("ce-source")
    ce_time = request.headers.get("ce-time")

    if not ce_type or not ce_id or not ce_source:
        raise HTTPException(
            status_code=400,
            detail="Missing required CloudEvent headers (ce-type, ce-id, ce-source)",
        )

    context = CloudEventContext(
        event_type=ce_type,
        event_id=ce_id,
        source=ce_source,
        time=ce_time,
    )

    # Parse body
    try:
        body = await request.json()
        envelope = PubSubEnvelope(**body)
    except json.JSONDecodeError as err:
        raise HTTPException(
            status_code=400, detail=f"Invalid JSON body: {err}"
        ) from err
    except ValidationError as err:
        raise HTTPException(
            status_code=422, detail=f"Invalid Pub/Sub message: {err}"
        ) from err

    # Decode base64 message data
    try:
        decoded_bytes = base64.b64decode(envelope.message.data)
        decoded_str = decoded_bytes.decode("utf-8")
        data = json.loads(decoded_str)
    except Exception as err:
        raise HTTPException(
            status_code=400, detail=f"Failed to decode message data: {err}"
        ) from err

    return context, data
