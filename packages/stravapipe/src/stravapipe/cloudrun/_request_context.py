"""Shared Pub/Sub request-context bootstrap for Cloud Run handlers.

Both Pub/Sub entrypoints — ``handle_webhook_cloudevent`` (webhook_handler) and
``handle_deauth_event`` (deletion_service_app) — open with the identical
correlation/trace/parse prologue before they enter their own ``record_span``
body. That prologue lives here once so a change to how Pub/Sub trace context is
established (e.g. a new attribute to read) happens in a single place.

This belongs on the ``cloudrun`` side rather than ``shared/correlation.py``,
which is deliberately framework-decoupled (it takes primitives and avoids
importing ``cloudrun.pubsub`` / ``shared.tracing``). The bootstrap below calls
both, so it lives with the handlers it serves.
"""

from dataclasses import dataclass
from typing import Any

from fastapi import Request
from opentelemetry.context import Context

from stravapipe.cloudrun.pubsub import CloudEventContext, parse_pubsub_cloudevent
from stravapipe.shared.correlation import (
    apply_pubsub_request_context,
    initialize_pubsub_context,
    initialize_request_trace,
    new_correlation_id,
)
from stravapipe.shared.tracing import extract_context_from_attributes


@dataclass
class PubSubRequestContext:
    """Parsed pieces a Pub/Sub handler needs before opening its span."""

    context: CloudEventContext
    event_data: dict[str, Any]
    message_attributes: dict[str, str]
    correlation_id: str
    span_attrs: dict[str, Any]
    parent_context: Context | None


async def bootstrap_pubsub_request(request: Request) -> PubSubRequestContext:
    """Run the common Pub/Sub request prologue and return the parsed pieces.

    Performs everything shared by the webhook and deauth handlers up to (not
    including) ``record_span``: pre-generate a fallback correlation ID, seed the
    trace contextvar from the Cloud Run request headers, parse the CloudEvent,
    prefer the dispatcher's correlation ID + W3C traceparent, wire the
    request-scoped Pub/Sub contextvars, and extract the parent trace context.

    Must be called inside the handler's own ``try`` so parse failures surface as
    the handler's HTTPException. Webhook-only steps (e.g.
    ``set_dispatcher_received_at_ms``) stay at their call site.
    """
    # Pre-generate a fallback so it's available if parsing fails before we see
    # the PubSub attributes; set_correlation_id() makes it visible to
    # CorrelationFilter so any subsequent log call carries it automatically.
    correlation_id = new_correlation_id()

    # Best-effort: seed the trace contextvar from the Cloud Run request's
    # X-Cloud-Trace-Context header so any log emitted before we parse the PubSub
    # body already has trace linking. May be overwritten below by the W3C
    # traceparent from PubSub attributes (preferred — that's the cross-service
    # trace from the dispatcher).
    initialize_request_trace(request.headers)

    context, event_data, message_attributes = await parse_pubsub_cloudevent(request)

    # Prefer dispatcher's correlation_id over the pre-generated fallback, and
    # override the request-level trace with the cross-service W3C traceparent
    # attribute when present. Then wire request-scoped Pub/Sub identifiers onto
    # contextvars so CorrelationFilter mirrors them into every subsequent log
    # record's jsonPayload. The returned dict is the matching span_attrs map.
    correlation_id = initialize_pubsub_context(message_attributes, correlation_id)
    span_attrs = apply_pubsub_request_context(
        correlation_id,
        context.pubsub_message_id,
        context.delivery_attempt,
    )
    parent_context = extract_context_from_attributes(message_attributes)

    return PubSubRequestContext(
        context=context,
        event_data=event_data,
        message_attributes=message_attributes,
        correlation_id=correlation_id,
        span_attrs=span_attrs,
        parent_context=parent_context,
    )
