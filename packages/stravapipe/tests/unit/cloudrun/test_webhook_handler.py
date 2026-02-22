"""Unit tests for the shared webhook CloudEvent handler.

Tests the handle_webhook_cloudevent function in isolation using a minimal
FastAPI app, verifying CloudEvent parsing, webhook validation, aspect-type
routing, and error handling.
"""

import base64
import json
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
import pytest

from stravapipe.cloudrun.webhook_handler import handle_webhook_cloudevent


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


def make_pubsub_body(webhook_data: dict) -> dict:
    """Create a Pub/Sub message body with base64-encoded webhook data."""
    encoded_data = base64.b64encode(json.dumps(webhook_data).encode()).decode()
    return {
        "message": {
            "data": encoded_data,
            "messageId": "test-message-123",
            "publishTime": "2024-01-01T00:00:00Z",
        }
    }


def make_webhook_payload(
    aspect_type: str = "create",
    object_id: int = 12345678,
    owner_id: int = 98765,
    event_time: int = 1704067200,
) -> dict:
    """Create a valid webhook event payload."""
    return {
        "aspect_type": aspect_type,
        "event_time": event_time,
        "object_id": object_id,
        "object_type": "activity",
        "owner_id": owner_id,
        "subscription_id": 123456,
        "updates": {},
    }


logger = MagicMock()


@pytest.fixture
def app_with_callbacks():
    """Create a FastAPI app wired to handle_webhook_cloudevent with configurable callbacks."""

    def _make_app(
        on_create=None,
        on_update=None,
        on_delete=None,
    ):
        test_app = FastAPI()

        @test_app.post("/")
        async def handle(request: Request):
            return await handle_webhook_cloudevent(
                request,
                logger,
                on_create=on_create,
                on_update=on_update,
                on_delete=on_delete,
            )

        return TestClient(test_app)

    return _make_app


class TestCloudEventParsing:
    """Tests for CloudEvent parsing and validation."""

    def test_missing_cloudevent_headers_returns_400(self, app_with_callbacks):
        client = app_with_callbacks()
        response = client.post(
            "/",
            json=make_pubsub_body(make_webhook_payload()),
        )
        assert response.status_code == 400

    def test_invalid_json_body_returns_400(self, app_with_callbacks):
        client = app_with_callbacks()
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            content="not valid json",
        )
        assert response.status_code == 400

    def test_invalid_pubsub_envelope_returns_422(self, app_with_callbacks):
        client = app_with_callbacks()
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json={"not": "a pubsub message"},
        )
        assert response.status_code == 422


class TestWebhookValidation:
    """Tests for webhook payload validation."""

    def test_invalid_webhook_payload_returns_422(self, app_with_callbacks):
        client = app_with_callbacks()
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body({"aspect_type": "create"}),
        )
        assert response.status_code == 422
        assert "Invalid webhook" in response.json()["detail"]

    def test_non_activity_object_type_returns_422(self, app_with_callbacks):
        client = app_with_callbacks()
        webhook = make_webhook_payload()
        webhook["object_type"] = "athlete"
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(webhook),
        )
        assert response.status_code == 422
        assert "Unsupported object_type" in response.json()["detail"]


class TestAspectRouting:
    """Tests for routing to aspect-specific callbacks."""

    def test_create_event_routes_to_on_create(self, app_with_callbacks):
        on_create = AsyncMock(return_value={"status": "created"})
        client = app_with_callbacks(on_create=on_create)

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload(aspect_type="create")),
        )

        assert response.status_code == 200
        assert response.json() == {"status": "created"}
        on_create.assert_called_once()
        event, event_data, correlation_id = on_create.call_args.args
        assert event.object_id == 12345678
        assert event_data["aspect_type"] == "create"
        assert isinstance(correlation_id, str)

    def test_update_event_routes_to_on_update(self, app_with_callbacks):
        on_update = AsyncMock(return_value={"status": "updated"})
        client = app_with_callbacks(on_update=on_update)

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload(aspect_type="update")),
        )

        assert response.status_code == 200
        assert response.json() == {"status": "updated"}
        on_update.assert_called_once()

    def test_delete_event_routes_to_on_delete(self, app_with_callbacks):
        on_delete = AsyncMock(return_value={"status": "deleted"})
        client = app_with_callbacks(on_delete=on_delete)

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload(aspect_type="delete")),
        )

        assert response.status_code == 200
        assert response.json() == {"status": "deleted"}
        on_delete.assert_called_once()

    def test_unhandled_aspect_type_returns_skipped(self, app_with_callbacks):
        """Aspect type with no registered callback returns skipped."""
        client = app_with_callbacks()  # No callbacks registered

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload(aspect_type="create")),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "skipped"
        assert data["details"] == "Event type not implemented"

    def test_only_registered_callbacks_are_invoked(self, app_with_callbacks):
        """Update event doesn't invoke create callback."""
        on_create = AsyncMock(return_value={"status": "created"})
        client = app_with_callbacks(on_create=on_create)

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload(aspect_type="update")),
        )

        assert response.status_code == 200
        assert response.json()["status"] == "skipped"
        on_create.assert_not_called()


class TestErrorHandling:
    """Tests for error wrapping behavior."""

    def test_callback_exception_returns_500(self, app_with_callbacks):
        on_create = AsyncMock(side_effect=RuntimeError("Something broke"))
        client = app_with_callbacks(on_create=on_create)

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload(aspect_type="create")),
        )

        assert response.status_code == 500
        assert "Something broke" in response.json()["detail"]

    def test_correlation_id_is_unique_per_request(self, app_with_callbacks):
        correlation_ids = []
        async def capture_cid(event, event_data, cid):
            correlation_ids.append(cid)
            return {"status": "ok"}

        client = app_with_callbacks(on_create=capture_cid)

        for _ in range(3):
            client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="create")),
            )

        assert len(set(correlation_ids)) == 3
