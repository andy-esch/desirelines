"""Shared test fixtures for Cloud Run service tests."""

import base64
import json

SAMPLE_RAW_ACTIVITY = {
    "id": 12345678,
    "name": "Morning Run",
    "type": "Run",
    "sport_type": "Run",
    "distance": 5000.0,
    "moving_time": 1800,
    "elapsed_time": 2000,
    "start_date_local": "2024-01-01T08:00:00Z",
    "athlete": {"id": 98765, "resource_state": 1},
}

SAMPLE_RAW_ACTIVITY_WITH_MAP = {
    **SAMPLE_RAW_ACTIVITY,
    "map": {
        "id": "a12345678",
        "polyline": "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
        "resource_state": 3,
        "summary_polyline": "_p~iF~ps|U_ulLnnqC",
    },
}

SAMPLE_RAW_ACTIVITY_NO_POLYLINE = {
    **SAMPLE_RAW_ACTIVITY,
    "map": {
        "id": "a12345678",
        "polyline": None,
        "resource_state": 3,
        "summary_polyline": None,
    },
}


def make_cloudevent_headers(
    ce_type: str = "google.cloud.pubsub.topic.v1.messagePublished",
    ce_id: str = "test-event-123",
    ce_source: str = "//pubsub.googleapis.com/projects/test-project/topics/test-topic",
    ce_time: str = "2024-01-01T00:00:00Z",
) -> dict:
    """Create CloudEvent headers for test requests."""
    return {
        "ce-type": ce_type,
        "ce-id": ce_id,
        "ce-source": ce_source,
        "ce-time": ce_time,
        "content-type": "application/json",
    }


def make_pubsub_body(
    webhook_data: dict,
    attributes: dict[str, str] | None = None,
    delivery_attempt: int | None = None,
) -> dict:
    """Create a Pub/Sub message body with base64-encoded webhook data.

    Pass `delivery_attempt=N` to simulate a redelivered message (Pub/Sub sets
    this on the envelope when DLQ is configured). Omit it to mimic the
    first-delivery / no-DLQ shape where the field is absent.
    """
    encoded_data = base64.b64encode(json.dumps(webhook_data).encode()).decode()
    msg: dict = {
        "data": encoded_data,
        "messageId": "test-message-123",
        "publishTime": "2024-01-01T00:00:00Z",
    }
    if attributes:
        msg["attributes"] = attributes
    if delivery_attempt is not None:
        msg["deliveryAttempt"] = delivery_attempt
    return {"message": msg}


def make_webhook_payload(
    aspect_type: str = "create",
    object_id: int = 12345678,
    owner_id: int = 98765,
    event_time: int = 1704067200,
    raw_activity: dict | None = None,
) -> dict:
    """Create a valid enriched event payload."""
    payload = {
        "aspect_type": aspect_type,
        "event_time": event_time,
        "object_id": object_id,
        "object_type": "activity",
        "owner_id": owner_id,
        "subscription_id": 123456,
        "updates": {},
    }
    if raw_activity is not None:
        payload["raw_activity"] = raw_activity
    return payload
