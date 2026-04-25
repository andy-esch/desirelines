"""Shared webhook CloudEvent handler for Cloud Run services.

Extracts the common boilerplate for parsing Pub/Sub CloudEvents, validating
webhook payloads, and routing by aspect type. Each service provides
aspect-specific callbacks.
"""

from collections.abc import Awaitable, Callable
import logging
from logging import LoggerAdapter
from typing import Any
import uuid

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

    Returns:
        WebhookResponse with status and details

    Raises:
        HTTPException: On parsing/validation errors (4xx) or unexpected errors (5xx)
    """
    correlation_id = str(uuid.uuid4())

    try:
        context, event_data, message_attributes = await parse_pubsub_cloudevent(request)

        # Prefer dispatcher's correlation_id over the pre-generated fallback.
        correlation_id = message_attributes.get("correlation_id") or correlation_id

        # Extract W3C trace context from dispatcher's traceparent header.
        parent_context = extract_context_from_attributes(message_attributes)

        # IMPORTANT: The span must wrap ALL log statements below. The
        # google-cloud-logging library reads the active OTel span and
        # populates trace/spanId/traceSampled on each log entry. Logs
        # emitted outside this block will not be linked to the trace in
        # Cloud Trace and will be invisible when viewing "Show logs" on
        # a trace. If you add new log lines, keep them inside this span.
        with record_span(
            tracer,
            "webhook.process",
            attributes={"correlation_id": correlation_id},
            parent_context=parent_context,
        ):
            logger.info(
                "Received CloudEvent",
                extra={
                    "correlation_id": correlation_id,
                    "event_type": context.event_type,
                    "event_id": context.event_id,
                },
            )

            try:
                event = dict_to_webhook_event(event_data)
            except ValueError as err:
                logger.exception(
                    "Webhook parsing failed",
                    extra={"correlation_id": correlation_id},
                )
                raise HTTPException(
                    status_code=422, detail=f"Invalid webhook: {err}"
                ) from err

            if event.object_type != pb.OBJECT_TYPE_ACTIVITY:
                obj_name = pb.ObjectType.Name(event.object_type)
                logger.info(
                    "Skipping non-activity webhook",
                    extra={
                        "correlation_id": correlation_id,
                        "object_type": obj_name,
                    },
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
                    "correlation_id": correlation_id,
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

            logger.info(
                "Skipping event type: %s",
                aspect_name,
                extra={"correlation_id": correlation_id},
            )
            return WebhookResponse(
                status=ResponseStatus.SKIPPED,
                reason=SkipReason.NOT_IMPLEMENTED,
                details=f"Event type '{aspect_name}' not implemented for this service",
                correlation_id=correlation_id,
            )

    except HTTPException:
        raise
    except Exception as err:
        logger.error(
            "Unexpected error: %s",
            err,
            extra={"correlation_id": correlation_id},
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail="An internal server error occurred."
        ) from err
