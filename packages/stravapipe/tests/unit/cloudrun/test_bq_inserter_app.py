"""Unit tests for bq_inserter_app FastAPI endpoints.

Tests the HTTP interface layer using FastAPI's TestClient, with mocked service
layer to isolate endpoint logic from business logic and external dependencies.
"""

import base64
import json
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest


@pytest.fixture
def mock_bq_config():
    """Mock configuration to skip validation at startup."""
    with patch("stravapipe.cloudrun.bq_inserter_app.load_bq_inserter_config") as mock:
        mock.return_value = MagicMock()
        yield mock


@pytest.fixture
def client(mock_bq_config):
    """Create a test client with mocked configuration."""
    from stravapipe.cloudrun.bq_inserter_app import app

    return TestClient(app)


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
    """Create a valid Strava webhook payload."""
    return {
        "aspect_type": aspect_type,
        "event_time": event_time,
        "object_id": object_id,
        "object_type": "activity",
        "owner_id": owner_id,
        "subscription_id": 123456,
        "updates": {},
    }


class TestHealthEndpoint:
    """Tests for /health endpoint."""

    def test_health_returns_healthy_status(self, client):
        """Health endpoint returns 200 with healthy status."""
        response = client.get("/health")

        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}


class TestPostEndpointValidation:
    """Tests for POST / endpoint - validation and error handling."""

    def test_missing_cloudevent_headers_returns_400(self, client):
        """Request without CloudEvent headers returns 400."""
        response = client.post(
            "/",
            json=make_pubsub_body(make_webhook_payload()),
        )

        assert response.status_code == 400
        assert "Missing required CloudEvent headers" in response.json()["detail"]

    def test_missing_ce_type_header_returns_400(self, client):
        """Request without ce-type header returns 400."""
        headers = make_cloudevent_headers()
        del headers["ce-type"]

        response = client.post(
            "/",
            headers=headers,
            json=make_pubsub_body(make_webhook_payload()),
        )

        assert response.status_code == 400

    def test_invalid_json_body_returns_400(self, client):
        """Request with invalid JSON body returns 400."""
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            content="not valid json",
        )

        assert response.status_code == 400

    def test_invalid_pubsub_envelope_returns_422(self, client):
        """Request with invalid Pub/Sub envelope returns 422."""
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json={"not": "a pubsub message"},
        )

        assert response.status_code == 422

    def test_invalid_webhook_payload_returns_422(self, client):
        """Request with invalid webhook data returns 422."""
        invalid_webhook = {"aspect_type": "create"}  # Missing required fields

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(invalid_webhook),
        )

        assert response.status_code == 422

    def test_invalid_object_type_returns_422(self, client):
        """Webhook with unsupported object_type returns 422."""
        webhook = make_webhook_payload()
        webhook["object_type"] = "athlete"  # Only "activity" is supported

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(webhook),
        )

        assert response.status_code == 422


class TestCreateEventHandling:
    """Tests for CREATE aspect_type handling."""

    def test_create_event_success(self, client):
        """CREATE event successfully syncs activity to BigQuery."""
        with patch(
            "stravapipe.cloudrun.bq_inserter_app.make_sync_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_factory.return_value = mock_service

            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="create")),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "created"
            assert data["activity_id"] == 12345678
            mock_service.run.assert_called_once_with(12345678)

    def test_create_event_activity_not_found(self, client):
        """CREATE event when activity not found in Strava returns skipped."""
        from stravapipe.exceptions import ActivityNotFoundError

        with patch(
            "stravapipe.cloudrun.bq_inserter_app.make_sync_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.run.side_effect = ActivityNotFoundError("Not found")
            mock_factory.return_value = mock_service

            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="create")),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "skipped"
            assert data["reason"] == "activity_not_found"


class TestUpdateEventHandling:
    """Tests for UPDATE aspect_type handling - BQ inserter skips updates."""

    def test_update_event_is_skipped(self, client):
        """UPDATE events are skipped by BQ inserter."""
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(make_webhook_payload(aspect_type="update")),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "skipped"
        assert data["reason"] == "update"
        assert "not implemented" in data["details"].lower()


class TestDeleteEventHandling:
    """Tests for DELETE aspect_type handling."""

    def test_delete_event_success(self, client):
        """DELETE event successfully archives and removes activity."""
        expected_result = {
            "status": "deleted",
            "activity_id": 12345678,
            "correlation_id": "test-correlation-id",
        }

        with patch(
            "stravapipe.cloudrun.bq_inserter_app.make_delete_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.run.return_value = expected_result
            mock_factory.return_value = mock_service

            webhook = make_webhook_payload(aspect_type="delete")
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "deleted"

            # Verify service was called with correct arguments
            mock_service.run.assert_called_once()
            call_kwargs = mock_service.run.call_args.kwargs
            assert call_kwargs["activity_id"] == 12345678
            assert call_kwargs["event_time"] == webhook["event_time"]
            assert "correlation_id" in call_kwargs


class TestErrorHandling:
    """Tests for error handling behavior."""

    def test_unexpected_error_returns_500(self, client):
        """Unexpected errors return 500 to trigger Pub/Sub retry."""
        with patch(
            "stravapipe.cloudrun.bq_inserter_app.make_sync_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.run.side_effect = RuntimeError("BigQuery error")
            mock_factory.return_value = mock_service

            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="create")),
            )

            assert response.status_code == 500
            assert "BigQuery error" in response.json()["detail"]
