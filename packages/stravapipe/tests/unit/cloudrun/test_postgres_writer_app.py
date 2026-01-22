"""Unit tests for postgres_writer_app FastAPI endpoints.

Tests the HTTP interface layer using FastAPI's TestClient, with mocked service
layer to isolate endpoint logic from business logic and external dependencies.
"""

import base64
import json
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest


@pytest.fixture
def mock_postgres_config():
    """Mock configuration to skip validation at startup."""
    with patch(
        "stravapipe.cloudrun.postgres_writer_app.load_postgres_writer_config"
    ) as mock:
        mock.return_value = MagicMock()
        yield mock


@pytest.fixture
def client(mock_postgres_config):
    """Create a test client with mocked configuration."""
    from stravapipe.cloudrun.postgres_writer_app import app

    with patch(
        "stravapipe.cloudrun.postgres_writer_app.make_session_factory"
    ) as mock_make_session_factory:
        mock_make_session_factory.return_value = MagicMock()
        with TestClient(app) as client:
            yield client


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
        """CREATE event successfully creates activity."""
        with patch(
            "stravapipe.cloudrun.postgres_writer_app.make_postgres_write_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.create_activity.return_value = True
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
            mock_service.create_activity.assert_called_once_with(12345678)

    def test_create_event_already_exists(self, client):
        """CREATE event for existing activity returns skipped."""
        with patch(
            "stravapipe.cloudrun.postgres_writer_app.make_postgres_write_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.create_activity.return_value = False  # Already exists
            mock_factory.return_value = mock_service

            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="create")),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "skipped"
            assert data["reason"] == "already_exists"

    def test_create_event_activity_not_found(self, client):
        """CREATE event when activity not found in Strava returns skipped."""
        from stravapipe.exceptions import ActivityNotFoundError

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.make_postgres_write_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.create_activity.side_effect = ActivityNotFoundError(
                "Not found"
            )
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
    """Tests for UPDATE aspect_type handling."""

    def test_update_event_no_relevant_updates_skipped(self, client):
        """UPDATE event with no relevant changes is skipped."""
        webhook = make_webhook_payload(aspect_type="update")
        webhook["updates"] = {"private": "true"}  # Not relevant (title/type)

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(webhook),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "skipped"
        assert data["reason"] == "no_relevant_updates"

    def test_update_event_with_title_update(self, client):
        """UPDATE event with title change updates activity."""
        webhook = make_webhook_payload(aspect_type="update")
        webhook["updates"] = {"title": "New Title"}

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.make_postgres_write_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.activity_exists.return_value = True
            mock_service.update_activity_metadata.return_value = True
            mock_factory.return_value = mock_service

            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "updated"
            mock_service.update_activity_metadata.assert_called_once_with(
                12345678, {"title": "New Title"}
            )

    def test_update_event_backfills_missing_activity(self, client):
        """UPDATE event backfills activity not in PostgreSQL."""
        webhook = make_webhook_payload(aspect_type="update")
        webhook["updates"] = {"type": "Run"}

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.make_postgres_write_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.activity_exists.return_value = False  # Not in DB
            mock_service.create_activity.return_value = True  # Backfill succeeds
            mock_factory.return_value = mock_service

            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "created"  # Backfilled
            mock_service.create_activity.assert_called_once_with(12345678)


class TestDeleteEventHandling:
    """Tests for DELETE aspect_type handling."""

    def test_delete_event_success(self, client):
        """DELETE event successfully removes activity."""
        with patch(
            "stravapipe.cloudrun.postgres_writer_app.make_postgres_write_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.delete_activity.return_value = True
            mock_factory.return_value = mock_service

            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="delete")),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "deleted"
            assert data["activity_id"] == 12345678

    def test_delete_event_not_found(self, client):
        """DELETE event for non-existent activity returns skipped."""
        with patch(
            "stravapipe.cloudrun.postgres_writer_app.make_postgres_write_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.delete_activity.return_value = False  # Not found
            mock_factory.return_value = mock_service

            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="delete")),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "skipped"
            assert data["reason"] == "not_found"


class TestErrorHandling:
    """Tests for error handling behavior."""

    def test_unexpected_error_returns_500(self, client):
        """Unexpected errors return 500 to trigger Pub/Sub retry."""
        with patch(
            "stravapipe.cloudrun.postgres_writer_app.make_postgres_write_service"
        ) as mock_factory:
            mock_service = MagicMock()
            mock_service.create_activity.side_effect = RuntimeError("Database error")
            mock_factory.return_value = mock_service

            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(make_webhook_payload(aspect_type="create")),
            )

            assert response.status_code == 500
            assert "Database error" in response.json()["detail"]
