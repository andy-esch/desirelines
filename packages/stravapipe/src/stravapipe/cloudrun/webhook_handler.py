"""Shared webhook CloudEvent handler for Cloud Run services.

Extracts the common boilerplate for parsing Pub/Sub CloudEvents, validating
webhook payloads, and routing by aspect type. Each service provides
aspect-specific callbacks.
"""

from collections.abc import Awaitable, Callable
import logging
from logging import LoggerAdapter
from typing import Any

from fastapi import HTTPException, Request
from opentelemetry.metrics import Counter
from opentelemetry.trace import Tracer, get_current_span

from stravapipe.adapters.proto import dict_to_webhook_event
from stravapipe.cloudrun.pubsub import parse_pubsub_cloudevent
from stravapipe.shared.constants import (
    DEFAULT_UNKNOWN,
    ResponseStatus,
    SkipReason,
    WebhookField,
)
from stravapipe.shared.correlation import (
    apply_pubsub_request_context,
    extract_dispatcher_received_at_from_attributes,
    initialize_pubsub_context,
    initialize_request_trace,
    new_correlation_id,
    set_dispatcher_received_at_ms,
)
from stravapipe.shared.responses import WebhookResponse
from stravapipe.shared.tracing import extract_context_from_attributes, record_span
from stravapipe.types.generated import webhook_pb2 as pb

# Callback type for aspect handlers.
# Receives (event, event_data, correlation_id) and returns a WebhookResponse.
AspectCallback = Callable[
    [pb.WebhookEvent, dict[str, Any], str], Awaitable[WebhookResponse]
]


async def handle_webhook_cloudevent(
    request: Request,
    logger: logging.Logger | LoggerAdapter[logging.Logger],
    *,
    on_create: AspectCallback | None = None,
    on_update: AspectCallback | None = None,
    on_delete: AspectCallback | None = None,
    webhook_counter: Counter | None = None,
    tracer: Tracer | None = None,
    span_name: str = "webhook.process",
) -> WebhookResponse:
    """Parse a Pub/Sub CloudEvent and route to aspect-specific callbacks.

    Handles correlation ID extraction/generation, CloudEvent parsing, webhook
    validation, object type checks, and error wrapping consistently across
    services.

    Args:
        request: FastAPI request object
        logger: Service-specific logger
        on_create: Callback for ASPECT_TYPE_CREATE events
        on_update: Callback for ASPECT_TYPE_UPDATE events
        on_delete: Callback for ASPECT_TYPE_DELETE events
        webhook_counter: Optional OTel counter for webhook events
        tracer: Optional OTel tracer for distributed tracing
        span_name: Name for the root processing span. Callers should pass a
            service-prefixed name (e.g. ``"bq_inserter.webhook.process"``) so
            traces from different services don't collide visually in Cloud
            Trace's compact view. The OTel ``service.name`` resource attribute
            already disambiguates them in detail views, but Cloud Trace's
            timeline shows only the span name. Defaults to ``"webhook.process"``
            for the test fixture.

    Returns:
        WebhookResponse with status and details

    Raises:
        HTTPException: On parsing/validation errors (4xx) or unexpected errors (5xx)
    """
    # Pre-generate a fallback so it's available if parsing fails before we
    # see the PubSub attributes. set_correlation_id() makes it visible to
    # CorrelationFilter so any subsequent log call carries it automatically.
    correlation_id = new_correlation_id()

    # Best-effort: seed the trace contextvar from the Cloud Run request's
    # X-Cloud-Trace-Context header so any log emitted before we parse the
    # PubSub body already has trace linking. May be overwritten below by the
    # W3C traceparent from PubSub attributes (preferred — that's the
    # cross-service trace from the dispatcher).
    initialize_request_trace(request)

    try:
        context, event_data, message_attributes = await parse_pubsub_cloudevent(request)

        # Prefer dispatcher's correlation_id over the pre-generated fallback,
        # and override the request-level trace with the cross-service W3C
        # traceparent attribute when present. Then wire request-scoped Pub/Sub
        # identifiers onto contextvars so CorrelationFilter mirrors them into
        # every subsequent log record's jsonPayload. The returned dict is the
        # matching span_attrs map.
        correlation_id = initialize_pubsub_context(message_attributes, correlation_id)
        span_attrs = apply_pubsub_request_context(
            correlation_id,
            context.pubsub_message_id,
            context.delivery_attempt,
        )

        parent_context = extract_context_from_attributes(message_attributes)

        # Extract dispatcher receive timestamp so handlers can record the
        # end-to-end webhook freshness histogram (anchors SLO 3, data
        # freshness). Stashed on a contextvar so handler-side code reads it
        # without needing to thread `message_attributes` through the
        # callback signature.
        set_dispatcher_received_at_ms(
            extract_dispatcher_received_at_from_attributes(message_attributes)
        )

        # IMPORTANT: The span must wrap ALL log statements below. The
        # google-cloud-logging library reads the active OTel span and
        # populates trace/spanId/traceSampled on each log entry. Logs
        # emitted outside this block will not be linked to the trace in
        # Cloud Trace and will be invisible when viewing "Show logs" on
        # a trace. If you add new log lines, keep them inside this span.
        with record_span(
            tracer,
            span_name,
            attributes=span_attrs,
            parent_context=parent_context,
        ):
            logger.info(
                "Received CloudEvent",
                extra={
                    "event_type": context.event_type,
                    "event_id": context.event_id,
                    "pubsub_message_id": context.pubsub_message_id,
                    "delivery_attempt": context.delivery_attempt,
                },
            )

            try:
                event = dict_to_webhook_event(event_data)
            except ValueError as err:
                logger.exception("Webhook parsing failed")
                raise HTTPException(
                    status_code=422, detail=f"Invalid webhook: {err}"
                ) from err

            if event.object_type != pb.OBJECT_TYPE_ACTIVITY:
                obj_name = pb.ObjectType.Name(event.object_type)
                logger.info(
                    "Skipping non-activity webhook",
                    extra={"object_type": obj_name},
                )
                raise HTTPException(  # noqa: TRY301 — FastAPI idiom; routing logic raises HTTPException, outer `except HTTPException: raise` preserves status code
                    status_code=422,
                    detail=f"Unsupported object_type: {obj_name}. Only 'activity' is supported",
                )

            aspect_name = event_data.get(WebhookField.ASPECT_TYPE, DEFAULT_UNKNOWN)

            # Set span attributes now that we know the event details.
            span = get_current_span()
            span.set_attribute("aspect_type", aspect_name)
            span.set_attribute("object_id", event.object_id)

            # Record webhook event metric
            if webhook_counter is not None:
                webhook_counter.add(
                    1,
                    {
                        "aspect_type": aspect_name,
                        "object_type": "activity",
                    },
                )

            logger.info(
                "Processing webhook",
                extra={
                    "aspect_type": aspect_name,
                    "object_type": "activity",
                    "object_id": event.object_id,
                },
            )

            callbacks = {
                pb.ASPECT_TYPE_CREATE: on_create,
                pb.ASPECT_TYPE_UPDATE: on_update,
                pb.ASPECT_TYPE_DELETE: on_delete,
            }

            callback = callbacks.get(event.aspect_type)
            if callback is not None:
                return await callback(event, event_data, correlation_id)

            logger.info("Skipping event type: %s", aspect_name)
            return WebhookResponse(
                status=ResponseStatus.SKIPPED,
                reason=SkipReason.NOT_IMPLEMENTED,
                details=f"Event type '{aspect_name}' not implemented for this service",
                correlation_id=correlation_id,
            )

    except HTTPException:
        raise
    except Exception as err:
        logger.error("Unexpected error: %s", err, exc_info=True)
        raise HTTPException(
            status_code=500, detail="An internal server error occurred."
        ) from err
