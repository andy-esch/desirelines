"""CloudEvent Adapter for local development.

This service bridges the gap between the PubSub emulator (which sends raw push
messages) and Cloud Run services (which expect Eventarc CloudEvent format).

In production, Eventarc wraps PubSub messages with CloudEvent headers before
delivering to Cloud Run. This adapter replicates that behavior locally.

Architecture:
    PubSub Emulator -> CloudEvent Adapter -> Cloud Run Services
                       (adds ce-* headers)

Retry Limiting:
    The PubSub emulator doesn't support maxDeliveryAttempts, so this adapter
    tracks delivery attempts per message and returns 200 (ACK) after hitting
    the limit. This prevents retry storms from hammering external APIs.
"""

import logging
import os
from collections import defaultdict
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI, HTTPException, Request, Response

# Configure logging
log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="CloudEvent Adapter",
    description="Wraps PubSub emulator messages with CloudEvent headers for local development",
)

# Service name to internal Docker hostname mapping
SERVICE_ENDPOINTS = {
    "aggregator": "http://aggregator:8080",
    "bq-inserter": "http://bq-inserter:8080",
    "postgres-writer": "http://postgres-writer:8080",
}

# Project and topic for CloudEvent source
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "local-dev")
TOPIC_NAME = os.environ.get("GCP_PUBSUB_TOPIC", "desirelines_activity_events")

# Retry limiting (emulator doesn't support maxDeliveryAttempts)
MAX_DELIVERY_ATTEMPTS = int(os.environ.get("MAX_DELIVERY_ATTEMPTS", "2"))
message_attempts: dict[str, int] = defaultdict(int)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "service": "cloudevent-adapter"}


@app.post("/{target_service}")
async def forward_with_cloudevents(target_service: str, request: Request):
    """Receive PubSub push message and forward with CloudEvent headers.

    The PubSub emulator sends messages in this format:
    {
        "message": {
            "data": "base64-encoded-payload",
            "messageId": "123",
            "publishTime": "2024-01-01T00:00:00Z"
        },
        "subscription": "projects/local-dev/subscriptions/..."
    }

    Eventarc adds these headers before forwarding to Cloud Run:
    - ce-specversion: 1.0
    - ce-type: google.cloud.pubsub.topic.v1.messagePublished
    - ce-id: <messageId>
    - ce-source: //pubsub.googleapis.com/projects/<project>/topics/<topic>
    - ce-time: <publishTime>
    """
    if target_service not in SERVICE_ENDPOINTS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown service: {target_service}. "
            f"Available: {list(SERVICE_ENDPOINTS.keys())}",
        )

    target_url = SERVICE_ENDPOINTS[target_service]

    try:
        body = await request.json()
    except Exception as err:
        logger.error("Failed to parse request body: %s", err)
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {err}") from err

    # Extract message metadata for CloudEvent headers
    message = body.get("message", {})
    message_id = message.get("messageId", "unknown")
    publish_time = message.get("publishTime", datetime.now(UTC).isoformat())

    # Track delivery attempts per message+service to prevent retry storms
    attempt_key = f"{target_service}:{message_id}"
    message_attempts[attempt_key] += 1
    attempt = message_attempts[attempt_key]

    if attempt > MAX_DELIVERY_ATTEMPTS:
        logger.warning(
            "Message %s to %s exceeded max attempts (%d), ACKing to stop retries",
            message_id,
            target_service,
            MAX_DELIVERY_ATTEMPTS,
        )
        # Return 200 to ACK the message and stop retries
        return Response(
            content=f'{{"status": "dropped", "reason": "max_attempts_exceeded", "attempts": {attempt}}}',
            status_code=200,
            media_type="application/json",
        )

    # Build CloudEvent headers (matching Eventarc format)
    cloudevent_headers = {
        "ce-specversion": "1.0",
        "ce-type": "google.cloud.pubsub.topic.v1.messagePublished",
        "ce-id": message_id,
        "ce-source": f"//pubsub.googleapis.com/projects/{PROJECT_ID}/topics/{TOPIC_NAME}",
        "ce-time": publish_time,
        "content-type": "application/json",
    }

    logger.info(
        "Forwarding message %s to %s",
        message_id,
        target_service,
        extra={
            "message_id": message_id,
            "target_service": target_service,
            "target_url": target_url,
        },
    )

    # Forward to target service with CloudEvent headers
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                target_url,
                json=body,
                headers=cloudevent_headers,
            )

            logger.info(
                "Response from %s: %s (attempt %d/%d)",
                target_service,
                response.status_code,
                attempt,
                MAX_DELIVERY_ATTEMPTS,
                extra={
                    "message_id": message_id,
                    "target_service": target_service,
                    "status_code": response.status_code,
                    "attempt": attempt,
                },
            )

            # Clear attempt tracking on success
            if response.status_code < 400:
                message_attempts.pop(attempt_key, None)

            # Return the response from the target service
            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type=response.headers.get("content-type", "application/json"),
            )

        except httpx.ConnectError as err:
            logger.error(
                "Failed to connect to %s at %s: %s",
                target_service,
                target_url,
                err,
            )
            raise HTTPException(
                status_code=503,
                detail=f"Service {target_service} unavailable: {err}",
            ) from err
        except httpx.TimeoutException as err:
            logger.error("Timeout connecting to %s: %s", target_service, err)
            raise HTTPException(
                status_code=504, detail=f"Timeout connecting to {target_service}"
            ) from err


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)
