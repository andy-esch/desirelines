"""Unit tests for deletion_service_app FastAPI endpoints."""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from stravapipe.application.deletion.bq_user_deletion_service import BQDeletionResult

from .conftest import make_cloudevent_headers, make_pubsub_body


def _make_deauth_payload(owner_id: int = 98765) -> dict:
    """Create a deauth event payload matching what the dispatcher publishes."""
    return {
        "aspect_type": "update",
        "event_time": 1704067200,
        "object_id": owner_id,
        "object_type": "athlete",
        "owner_id": owner_id,
        "subscription_id": 123456,
        "updates": {"authorized": "false"},
    }


@pytest.fixture
def mock_deletion_config():
    with patch(
        "stravapipe.cloudrun.deletion_service_app.load_deletion_service_config"
    ) as mock:
        mock.return_value = MagicMock()
        yield mock


@pytest.fixture
def mock_services():
    """Set up mock services for the deletion service app."""
    return {
        "session_factory": MagicMock(),
        "bq_deletion_service": MagicMock(),
        "token_store": MagicMock(),
        "firestore_client": MagicMock(),
    }


@pytest.fixture
def client(mock_deletion_config, mock_services):
    with (
        patch(
            "stravapipe.cloudrun.deletion_service_app.create_session_factory"
        ) as mock_factory,
        patch("stravapipe.cloudrun.deletion_service_app.bigquery.Client"),
        patch("stravapipe.cloudrun.deletion_service_app.FirestoreClient"),
        patch(
            "stravapipe.cloudrun.deletion_service_app.BQUserDeletionService"
        ) as mock_bq_svc,
        patch(
            "stravapipe.cloudrun.deletion_service_app.FirestoreTokenStore"
        ) as mock_ts,
    ):
        mock_factory.return_value = mock_services["session_factory"]
        mock_bq_svc.return_value = mock_services["bq_deletion_service"]
        mock_ts.return_value = mock_services["token_store"]

        from stravapipe.cloudrun.deletion_service_app import app

        with TestClient(app) as c:
            # Override app state with our mocks
            app.state.session_factory = mock_services["session_factory"]
            app.state.bq_deletion_service = mock_services["bq_deletion_service"]
            app.state.token_store = mock_services["token_store"]
            app.state.firestore_client = mock_services["firestore_client"]
            yield c


class TestHealthEndpoint:
    def test_health_returns_healthy(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}


class TestDeauthEndpoint:
    def test_successful_deletion(self, client, mock_services):
        """Full deletion across all stores returns 200."""
        # Mock BQ deletion
        mock_services["bq_deletion_service"].run.return_value = BQDeletionResult(
            activities_archived=3,
            activities_deleted=3,
            staging_deleted=1,
        )

        # Mock UoW context manager
        mock_uow = MagicMock()
        mock_uow.__enter__ = MagicMock(return_value=mock_uow)
        mock_uow.__exit__ = MagicMock(return_value=False)
        mock_uow.activities.delete_by_user.return_value = 3

        with patch(
            "stravapipe.cloudrun.deletion_service_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(_make_deauth_payload()),
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "deleted"
        assert data["user_id"] == "98765"
        assert data["pg_deleted"] == 3

    def test_missing_owner_id_returns_422(self, client):
        """Event without owner_id returns 422."""
        payload = _make_deauth_payload()
        del payload["owner_id"]

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(payload),
        )

        assert response.status_code == 422
        assert "owner_id" in response.json()["detail"]

    def test_missing_cloudevent_headers_returns_400(self, client):
        response = client.post(
            "/",
            json=make_pubsub_body(_make_deauth_payload()),
        )
        assert response.status_code == 400

    def test_partial_failure_returns_500(self, client, mock_services):
        """If one store fails, returns 500 for Pub/Sub retry."""
        mock_services["bq_deletion_service"].run.side_effect = Exception("BQ down")

        mock_uow = MagicMock()
        mock_uow.__enter__ = MagicMock(return_value=mock_uow)
        mock_uow.__exit__ = MagicMock(return_value=False)
        mock_uow.activities.delete_by_user.return_value = 0

        with patch(
            "stravapipe.cloudrun.deletion_service_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(_make_deauth_payload()),
            )

        assert response.status_code == 500
        assert "bigquery" in response.json()["detail"]
