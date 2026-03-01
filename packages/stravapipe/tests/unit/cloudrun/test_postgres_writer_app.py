"""Unit tests for postgres_writer_app FastAPI endpoints.

Tests the HTTP interface layer using FastAPI's TestClient, with mocked service
layer to isolate endpoint logic from business logic and external dependencies.

Activity data is now provided inline in the enriched event (raw_activity field)
rather than fetched from the Strava API.
"""

import json
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from .conftest import (
    SAMPLE_RAW_ACTIVITY,
    SAMPLE_RAW_ACTIVITY_NO_POLYLINE,
    SAMPLE_RAW_ACTIVITY_WITH_MAP,
    make_cloudevent_headers,
    make_pubsub_body,
    make_webhook_payload,
)


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
        "stravapipe.cloudrun.postgres_writer_app.create_session_factory"
    ) as mock_factory:
        mock_factory.return_value = MagicMock()
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
        """CREATE event with raw_activity writes to PostgreSQL."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True
        mock_activity = MagicMock()

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=mock_activity,
            ),
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
            mock_uow.activities.insert.assert_called_once_with(mock_activity)

    def test_create_event_already_exists(self, client):
        """CREATE event for existing activity returns skipped."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = False  # Already exists
        mock_activity = MagicMock()

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=mock_activity,
            ),
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
            assert data["status"] == "skipped"
            assert data["reason"] == "already_exists"

    def test_create_event_with_polyline_inserts_route(self, client):
        """CREATE event with map.polyline also inserts route geometry."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True
        mock_uow.activities.insert_route.return_value = True

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY_WITH_MAP
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            assert response.json()["status"] == "created"
            mock_uow.activities.insert.assert_called_once()
            mock_uow.activities.insert_route.assert_called_once()
            # Verify geojson argument is a valid GeoJSON string
            call_args = mock_uow.activities.insert_route.call_args
            assert call_args[0][0] == 12345678  # activity_id

            geojson = json.loads(call_args[0][1])
            assert geojson["type"] == "LineString"

    def test_create_event_without_polyline_skips_route(self, client):
        """CREATE event with null polyline does not insert route."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY_NO_POLYLINE
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            assert response.json()["status"] == "created"
            mock_uow.activities.insert_route.assert_not_called()

    def test_create_event_without_map_skips_route(self, client):
        """CREATE event without map field does not insert route."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = True

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
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
            assert response.json()["status"] == "created"
            mock_uow.activities.insert_route.assert_not_called()

    def test_create_event_duplicate_skips_route(self, client):
        """CREATE event for existing activity skips route insert too."""
        mock_uow = MagicMock()
        mock_uow.activities.insert.return_value = False  # Already exists

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
        ):
            webhook = make_webhook_payload(
                aspect_type="create", raw_activity=SAMPLE_RAW_ACTIVITY_WITH_MAP
            )
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            assert response.json()["status"] == "skipped"
            mock_uow.activities.insert_route.assert_not_called()

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

        mock_uow = MagicMock()
        mock_uow.activities.exists.return_value = True
        mock_uow.activities.update_metadata.return_value = True

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "updated"

    def test_update_event_skips_missing_activity(self, client):
        """UPDATE event skips activity not in PostgreSQL (no backfill)."""
        webhook = make_webhook_payload(aspect_type="update")
        webhook["updates"] = {"type": "Run"}

        mock_uow = MagicMock()
        mock_uow.activities.exists.return_value = False  # Not in DB

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(webhook),
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "skipped"
            assert data["reason"] == "not_found"


class TestDeleteEventHandling:
    """Tests for DELETE aspect_type handling."""

    def test_delete_event_success(self, client):
        """DELETE event successfully removes activity."""
        mock_uow = MagicMock()
        mock_uow.activities.delete.return_value = True

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
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
        mock_uow = MagicMock()
        mock_uow.activities.delete.return_value = False  # Not found

        with patch(
            "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
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
        mock_uow = MagicMock()
        mock_uow.activities.insert.side_effect = RuntimeError("Database error")

        with (
            patch(
                "stravapipe.cloudrun.postgres_writer_app.SqlAlchemyUnitOfWork",
                return_value=mock_uow,
            ),
            patch(
                "stravapipe.cloudrun.postgres_writer_app.StandardActivity.model_validate",
                return_value=MagicMock(),
            ),
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
