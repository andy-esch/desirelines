"""Error-classification helpers for Cloud Run handlers.

Pub/Sub redelivers messages on 5xx and acks on 4xx. Permanent errors
(e.g. Strava schema drift causing pydantic validation failure) must
return 4xx so the message is acked and stops retrying. Transient errors
(BQ 503, network timeout) must return 5xx so Pub/Sub retries until
``max_delivery_attempts`` is reached.
"""

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from stravapipe.shared.logging import setup_logging

logger = setup_logging(__name__)


def validate_or_422[T: BaseModel](
    model_cls: type[T], payload: object, *, context: str
) -> T:
    """Run ``model_cls.model_validate(payload)``; map ValidationError → 422.

    A pydantic ``ValidationError`` is permanent — retrying the same payload
    will fail identically. Returning 422 lets Pub/Sub ack the message
    immediately rather than retrying ``max_delivery_attempts`` times before
    sending it to the DLQ.

    The HTTP response detail is intentionally minimal — error counts and
    raw payloads stay in the WARNING log, not in a body that may be
    visible to upstream callers or in Cloud Logging request metadata.
    """
    try:
        return model_cls.model_validate(payload)
    except ValidationError as err:
        logger.warning(
            "Pydantic validation failed; returning 422",
            extra={
                "validation_context": context,
                "validation_errors": err.error_count(),
            },
        )
        raise HTTPException(
            status_code=422, detail=f"Invalid {context}"
        ) from err
