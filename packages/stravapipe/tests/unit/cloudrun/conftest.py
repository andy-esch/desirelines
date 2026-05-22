"""Shared test fixtures for Cloud Run service tests."""

import base64
import json

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import Tracer

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
    dispatcher_received_at_ms: int | None = None,
) -> dict:
    """Create a Pub/Sub message body with base64-encoded webhook data.

    Pass `delivery_attempt=N` to simulate a redelivered message (Pub/Sub sets
    this on the envelope when DLQ is configured). Omit it to mimic the
    first-delivery / no-DLQ shape where the field is absent.

    Pass `dispatcher_received_at_ms=ms` to stamp the
    `dispatcher_received_at_unix_ms` attribute the dispatcher sets on every
    real message (used by postgres-writer to record SLO 3 freshness). Omit
    to mimic legacy / pre-rollout traffic, in which case the
    `_record_freshness` helper early-returns and no histogram emission
    occurs.
    """
    encoded_data = base64.b64encode(json.dumps(webhook_data).encode()).decode()
    merged_attributes: dict[str, str] = dict(attributes) if attributes else {}
    if dispatcher_received_at_ms is not None:
        merged_attributes["dispatcher_received_at_unix_ms"] = str(
            dispatcher_received_at_ms
        )
    msg: dict = {
        "data": encoded_data,
        "messageId": "test-message-123",
        "publishTime": "2024-01-01T00:00:00Z",
    }
    if merged_attributes:
        msg["attributes"] = merged_attributes
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


# ---------------------------------------------------------------------------
# Cross-service trace-propagation contract
# ---------------------------------------------------------------------------

# EXAMPLE_TRACEPARENT is the canonical W3C trace-context value used by the
# trace-propagation tests. The contract it encodes:
#
#   The dispatcher injects a `traceparent` PubSub *message attribute* in
#   W3C format `00-<32-hex trace-id>-<16-hex span-id>-<2-hex flags>`.
#   Every downstream CloudEvent handler must extract it (via
#   stravapipe.shared.tracing.extract_context_from_attributes) and parent
#   its processing span under it, so a single trace_id spans the whole
#   dispatcher -> Pub/Sub -> worker pipeline. See
#   docs/architecture/observability.md ("How propagation actually works").
#
# The trace-id below is the W3C spec's own canonical example, so a failed
# assertion is easy to recognize.
EXAMPLE_TRACE_ID_HEX = "0af7651916cd43dd8448eb211c80319c"
EXAMPLE_SPAN_ID_HEX = "b7ad6b7169203331"
EXAMPLE_TRACEPARENT = f"00-{EXAMPLE_TRACE_ID_HEX}-{EXAMPLE_SPAN_ID_HEX}-01"


def make_in_memory_tracer() -> tuple[Tracer, InMemorySpanExporter]:
    """Build a real OTel tracer backed by an in-memory exporter.

    Returns (tracer, exporter). Pass the tracer to the code under test,
    then read `exporter.get_finished_spans()` afterward to assert on the
    spans it emitted — e.g. that a processing span's trace_id matches an
    injected `traceparent`.
    """
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("trace-propagation-test"), exporter
