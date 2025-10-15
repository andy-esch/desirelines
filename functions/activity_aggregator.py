"""Desire Lines listener - builds JSON documents that are consumed by the desire lines
web app"""

import uuid

from cloudevents.http import CloudEvent
import functions_framework
from pydantic import ValidationError

from stravapipe.application.aggregator.usecases import (
    make_delete_summary_use_case,
    make_update_summary_use_case,
)
from stravapipe.cfutils.cloud_event import (
    CloudEventValidationError,
    MessageDecodeError,
    safe_decode_message,
    setup_cloud_function_logging,
    validate_cloud_event,
)
from stravapipe.cfutils.responses import (
    error_response,
    skipped_response,
    success_response,
)
from stravapipe.domain import AspectType, WebhookRequest
from stravapipe.exceptions import ActivityNotFoundError

# Set up logging
logger = setup_cloud_function_logging(__name__)


@functions_framework.cloud_event
def main(event: CloudEvent) -> dict:
    """Process CloudEvent and update activity summaries"""

    # Generate correlation ID for request tracing
    correlation_id = str(uuid.uuid4())

    # Log function invocation for debugging unacked messages
    logger.info(
        "Activity aggregator function invoked",
        extra={
            "correlation_id": correlation_id,
            "event_type": getattr(event, "type", "unknown"),
            "event_source": getattr(event, "source", "unknown"),
        },
    )

    try:
        # Validate CloudEvent structure
        validate_cloud_event(event)
        logger.info(
            "CloudEvent validation successful - processing message",
            extra={
                "correlation_id": correlation_id,
                "message_id": event.data.get("message", {}).get("messageId", "unknown"),
                "publish_time": event.data.get("message", {}).get(
                    "publishTime", "unknown"
                ),
            },
        )

        # Safely decode message data
        try:
            event_data = safe_decode_message(event.data["message"]["data"])
        except MessageDecodeError as e:
            logger.error(
                "Failed to decode CloudEvent message: %s",
                e,
                extra={"correlation_id": correlation_id},
            )
            return error_response("message_decode_failed", str(e), correlation_id)

        # Parse and validate webhook request
        try:
            parsed_request = WebhookRequest(**event_data)
        except ValidationError as e:
            logger.error(
                "Webhook validation failed: %s",
                str(e),
                extra={"correlation_id": correlation_id},
            )
            return error_response("validation_failed", str(e), correlation_id)

        logger.info(
            "Parsed webhook event",
            extra={"correlation_id": correlation_id, **parsed_request.model_dump()},
        )

        # Route to appropriate handler based on aspect_type
        if parsed_request.aspect_type == AspectType.CREATE:
            # Handle create events
            try:
                # Initialize summary update service
                usecase = make_update_summary_use_case()

                # Update summary data with webhook request
                logger.info(
                    "Starting summary update for activity",
                    extra={
                        "correlation_id": correlation_id,
                        "activity_id": parsed_request.object_id,
                        "owner_id": parsed_request.owner_id,
                        "aspect_type": parsed_request.aspect_type.value,
                    },
                )
                usecase.run(parsed_request)
                logger.info(
                    "Successfully updated summary for activity %s",
                    parsed_request.object_id,
                    extra={"correlation_id": correlation_id},
                )
                return success_response(
                    "created", parsed_request.object_id, correlation_id
                )
            except ActivityNotFoundError:
                # Activity not found (404)
                # This is expected and should not trigger retry or DLQ
                logger.warning(
                    "Activity %s not found in Strava "
                    "(already deleted, never existed, or don't have access)",
                    parsed_request.object_id,
                    extra={
                        "correlation_id": correlation_id,
                        "activity_id": parsed_request.object_id,
                        "error_type": "activity_not_found",
                    },
                )
                return skipped_response(
                    "activity_not_found", correlation_id, parsed_request.object_id
                )
            except Exception as e:
                logger.error(
                    "Summary update failed for activity %s: %s",
                    parsed_request.object_id,
                    str(e),
                    extra={"correlation_id": correlation_id},
                    exc_info=True,
                )
                # Re-raise to trigger PubSub retry and eventual DLQ forwarding
                raise

        elif parsed_request.aspect_type == AspectType.DELETE:
            # Handle delete events
            try:
                # Initialize delete summary service
                delete_usecase = make_delete_summary_use_case()

                # Remove activity from summary
                logger.info(
                    "Starting summary delete for activity",
                    extra={
                        "correlation_id": correlation_id,
                        "activity_id": parsed_request.object_id,
                        "owner_id": parsed_request.owner_id,
                        "aspect_type": parsed_request.aspect_type.value,
                    },
                )
                delete_usecase.run(parsed_request)
                logger.info(
                    "Successfully deleted activity %s from summary",
                    parsed_request.object_id,
                    extra={"correlation_id": correlation_id},
                )
                return success_response(
                    "deleted", parsed_request.object_id, correlation_id
                )
            except ActivityNotFoundError as e:
                # Activity not found - could be in BigQuery or summary
                error_message = str(e)

                # Distinguish between BigQuery miss (retry) vs summary miss (skip)
                if "BigQuery" in error_message:
                    # Activity not in BigQuery - this might be a race condition
                    # BQ inserter may still be processing, worth retrying
                    logger.error(
                        "Activity %s not found in BigQuery for deletion: %s",
                        parsed_request.object_id,
                        error_message,
                        extra={
                            "correlation_id": correlation_id,
                            "activity_id": parsed_request.object_id,
                            "error_type": "activity_not_found_in_bigquery",
                        },
                    )
                    # Re-raise to trigger retry (race condition handling)
                    raise
                else:
                    # Activity not in summary - this is normal/expected
                    # Activity may have been filtered (wrong type) or never aggregated
                    logger.warning(
                        "Activity %s not in summary for deletion (skipping): %s",
                        parsed_request.object_id,
                        error_message,
                        extra={
                            "correlation_id": correlation_id,
                            "activity_id": parsed_request.object_id,
                            "error_type": "activity_not_in_summary",
                        },
                    )
                    # Return success - nothing to delete from summary
                    return skipped_response(
                        "activity_not_in_summary",
                        correlation_id,
                        parsed_request.object_id,
                    )
            except Exception as e:
                logger.error(
                    "Summary delete failed for activity %s: %s",
                    parsed_request.object_id,
                    str(e),
                    extra={"correlation_id": correlation_id},
                    exc_info=True,
                )
                # Re-raise to trigger PubSub retry and eventual DLQ forwarding
                raise

        else:
            # Skip update events (AspectType.UPDATE - not implemented)
            logger.info(
                "Skipping event type: %s",
                parsed_request.aspect_type.value,
                extra={"correlation_id": correlation_id},
            )
            return skipped_response(
                parsed_request.aspect_type.value,
                correlation_id,
                details="Event type not implemented",
            )

    except CloudEventValidationError as e:
        logger.error(
            "Invalid CloudEvent structure: %s",
            e,
            extra={"correlation_id": correlation_id},
        )
        # Re-raise to trigger PubSub retry and eventual DLQ forwarding
        raise

    except Exception as e:
        logger.error(
            "Unexpected error processing CloudEvent: %s",
            str(e),
            extra={"correlation_id": correlation_id},
            exc_info=True,
        )
        # Re-raise to trigger PubSub retry and eventual DLQ forwarding
        raise
