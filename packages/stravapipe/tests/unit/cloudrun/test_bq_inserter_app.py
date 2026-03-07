"""Unit tests for bq_inserter_app FastAPI endpoints.

Tests the HTTP interface layer using FastAPI's TestClient, with mocked service
layer to isolate endpoint logic from business logic and external dependencies.

Activity data is now provided inline in the enriched event (raw_activity field)
rather than fetched from the Strava API.
"""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from .conftest import (
    SAMPLE_RAW_ACTIVITY,
    make_cloudevent_headers,
    make_pubsub_body,
    make_webhook_payload,
)


@pytest.fixture
def mock_bq_config():
    """Mock configuration to skip validation at startup."""
    with patch("stravapipe.cloudrun.bq_inserter_app.load_bq_inserter_config") as mock:
        mock.return_value = MagicMock()
        yield mock


@pytest.fixture
def client(mock_bq_config):
    """Create a test client with mocked configuration."""
    mock_writer = MagicMock()
    mock_writer.write_activity.return_value = {"rows_affected": 0}

    mock_delete_service = MagicMock()

    with (
        patch(
            "stravapipe.cloudrun.bq_inserter_app.make_write_activities",
            return_value=mock_writer,
        ),
        patch(
            "stravapipe.cloudrun.bq_inserter_app.make_delete_service",
            return_value=mock_delete_service,
        ),
    ):
        from stravapipe.cloudrun.bq_inserter_app import app

        with TestClient(app) as client:
            yield client


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
        """CREATE event with raw_activity writes to BigQuery."""
        from stravapipe.cloudrun.bq_inserter_app import app

        mock_writer = MagicMock()
        mock_writer.write_activity.return_value = {"rows_affected": 1}
        mock_activity = MagicMock()

        app.state.writer = mock_writer

        with patch(
            "stravapipe.cloudrun.bq_inserter_app.DetailedStravaActivity.model_validate",
            return_value=mock_activity,
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "created"
            assert data["activity_id"] == 12345678
            mock_writer.write_activity.assert_called_once_with(mock_activity)

    def test_create_event_missing_raw_activity(self, client):
        """CREATE event without raw_activity returns skipped."""
        webhook = make_webhook_payload(aspect_type="create")
        # No raw_activity field

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(webhook),
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
        assert data["reason"] == "not_implemented"


class TestDeleteEventHandling:
    """Tests for DELETE aspect_type handling."""

    def test_delete_event_success(self, client):
        """DELETE event successfully archives and removes activity."""
        from stravapipe.cloudrun.bq_inserter_app import app

        expected_result = {
            "status": "deleted",
            "activity_id": 12345678,
            "correlation_id": "test-correlation-id",
        }

        mock_service = app.state.delete_service
        mock_service.run.return_value = expected_result

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
        from stravapipe.cloudrun.bq_inserter_app import app

        mock_writer = MagicMock()
        mock_writer.write_activity.side_effect = RuntimeError("BigQuery error")

        app.state.writer = mock_writer

        with patch(
            "stravapipe.cloudrun.bq_inserter_app.DetailedStravaActivity.model_validate",
            return_value=MagicMock(),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 500
            assert "internal server error" in response.json()["detail"]
