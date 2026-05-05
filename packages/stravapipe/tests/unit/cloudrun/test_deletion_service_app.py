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
        patch("stravapipe.cloudrun.deletion_service_app.BigQueryClientWrapper"),
        patch("stravapipe.cloudrun.deletion_service_app.FirestoreClient"),
        patch(
            "stravapipe.cloudrun.deletion_service_app.BQUserDeletionService"
        ) as mock_bq_svc,
        patch(
            "stravapipe.cloudrun.deletion_service_app.FirestoreTokenStore"
        ) as mock_ts,
    ):
        mock_factory.return_value = (MagicMock(), mock_services["session_factory"])
        mock_bq_svc.return_value = mock_services["bq_deletion_service"]
        mock_ts.return_value = mock_services["token_store"]

        from stravapipe.cloudrun.deletion_service_app import app

        with TestClient(app) as c:
            # Override app state with our mocks
            app.state.session_factory = mock_services["session_factory"]
            app.state.bq_deletion_service = mock_services["bq_deletion_service"]
            app.state.token_store = mock_services["token_store"]
            app.state.firestore_client = mock_services["firestore_client"]
            # Override the MagicMock timeout that lifespan picked up from the
            # mocked config — asyncio.wait_for needs a real number.
            app.state.readiness_timeout = 5.0
            yield c


class TestHealthEndpoint:
    def test_health_returns_healthy(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}


class TestReadyEndpoint:
    """Tests for /ready endpoint — probes BigQuery + Firestore."""

    def test_ready_returns_200_when_all_reachable(self, client):
        """Both probes succeed → 200 with both components healthy."""
        from stravapipe.cloudrun.deletion_service_app import app

        mock_bq = MagicMock()
        mock_bq.get_dataset.return_value = MagicMock()
        mock_fs = MagicMock()
        mock_fs.collection.return_value.limit.return_value.get.return_value = []

        app.state.bq_client = mock_bq
        app.state.bq_dataset = "test_dataset"
        app.state.firestore_client = mock_fs

        response = client.get("/ready")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "healthy"
        assert body["components"] == {
            "bigquery": "healthy",
            "firestore": "healthy",
        }
        mock_bq.get_dataset.assert_called_once_with("test_dataset")

    def test_ready_returns_503_when_bigquery_fails(self, client):
        """BigQuery probe error → 503 even if Firestore is fine."""
        from stravapipe.cloudrun.deletion_service_app import app

        mock_bq = MagicMock()
        mock_bq.get_dataset.side_effect = RuntimeError("bq down")
        mock_fs = MagicMock()
        mock_fs.collection.return_value.limit.return_value.get.return_value = []

        app.state.bq_client = mock_bq
        app.state.bq_dataset = "test_dataset"
        app.state.firestore_client = mock_fs

        response = client.get("/ready")

        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "unhealthy"
        assert body["components"]["bigquery"] == "unhealthy"
        assert body["components"]["firestore"] == "healthy"
        assert "bq down" in body["errors"]["bigquery"]

    def test_ready_returns_503_when_firestore_fails(self, client):
        """Firestore probe error → 503 even if BigQuery is fine."""
        from stravapipe.cloudrun.deletion_service_app import app

        mock_bq = MagicMock()
        mock_bq.get_dataset.return_value = MagicMock()
        mock_fs = MagicMock()
        mock_fs.collection.return_value.limit.return_value.get.side_effect = (
            RuntimeError("firestore unavailable")
        )

        app.state.bq_client = mock_bq
        app.state.bq_dataset = "test_dataset"
        app.state.firestore_client = mock_fs

        response = client.get("/ready")

        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "unhealthy"
        assert body["components"]["firestore"] == "unhealthy"
        assert "firestore unavailable" in body["errors"]["firestore"]

    def test_ready_returns_503_on_timeout(self, client):
        """A probe that exceeds the timeout returns 503 with timeout marker."""
        import time

        from stravapipe.cloudrun.deletion_service_app import app

        def _block(_dataset):
            time.sleep(0.5)

        mock_bq = MagicMock()
        mock_bq.get_dataset.side_effect = _block
        mock_fs = MagicMock()
        mock_fs.collection.return_value.limit.return_value.get.return_value = []

        app.state.bq_client = mock_bq
        app.state.bq_dataset = "test_dataset"
        app.state.firestore_client = mock_fs
        app.state.readiness_timeout = 0.01

        # Patch retry backoff to 0 so the test doesn't pay the production
        # 1s pause for each persistent failure.
        with patch("stravapipe.shared.readiness.DEFAULT_READINESS_RETRY_BACKOFF", 0):
            response = client.get("/ready")

        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "unhealthy"
        assert "timeout" in body["errors"]["bigquery"]


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
        assert data["bq_activities_deleted"] == 3
        assert data["bq_staging_deleted"] == 1

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


class TestIdempotency:
    """Idempotency: redelivery of the same deauth event must not corrupt state."""

    def test_deletion_idempotent_on_redelivery(self, client, mock_services):
        """Second delivery returns 200 with zero counts — nothing left to delete.

        All four stores' delete operations are idempotent: PG/BQ DELETEs of
        already-deleted rows return 0 rows affected; Firestore .delete() is
        a no-op on missing documents.
        """
        # First call: data exists; second call: nothing left.
        mock_services["bq_deletion_service"].run.side_effect = [
            BQDeletionResult(
                activities_archived=3, activities_deleted=3, staging_deleted=1
            ),
            BQDeletionResult(
                activities_archived=0, activities_deleted=0, staging_deleted=0
            ),
        ]

        mock_uow = MagicMock()
        mock_uow.__enter__ = MagicMock(return_value=mock_uow)
        mock_uow.__exit__ = MagicMock(return_value=False)
        mock_uow.activities.delete_by_user.side_effect = [3, 0]

        with patch(
            "stravapipe.cloudrun.deletion_service_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            body = make_pubsub_body(_make_deauth_payload())
            headers = make_cloudevent_headers()

            r1 = client.post("/", headers=headers, json=body)
            r2 = client.post("/", headers=headers, json=body)

        assert r1.status_code == 200
        assert r1.json()["status"] == "deleted"
        assert r1.json()["pg_deleted"] == 3
        assert r1.json()["bq_activities_deleted"] == 3

        assert r2.status_code == 200
        assert r2.json()["status"] == "deleted"
        assert r2.json()["pg_deleted"] == 0
        assert r2.json()["bq_activities_deleted"] == 0
        assert r2.json()["bq_staging_deleted"] == 0


class TestLifespanCleanup:
    """Tests for application lifespan cleanup events."""

    def test_engine_disposal_on_shutdown(self, mock_deletion_config, mock_services):
        """SQLAlchemy engine is disposed when the app shuts down."""
        from stravapipe.cloudrun.deletion_service_app import app

        mock_deletion_config.return_value.project_id = "test-project"
        mock_deletion_config.return_value.bq_dataset = "test_dataset"
        mock_deletion_config.return_value.firestore_database = "(default)"

        mock_engine = MagicMock()
        mock_factory = MagicMock()

        with (
            patch(
                "stravapipe.cloudrun.deletion_service_app.create_session_factory",
                return_value=(mock_engine, mock_factory),
            ),
            patch("stravapipe.cloudrun.deletion_service_app.BigQueryClientWrapper"),
            patch("stravapipe.cloudrun.deletion_service_app.FirestoreClient"),
            patch("stravapipe.cloudrun.deletion_service_app.FirestoreTokenStore"),
            patch("stravapipe.cloudrun.deletion_service_app.BQUserDeletionService"),
        ):
            # TestClient context manager triggers startup and shutdown events
            with TestClient(app):
                # Startup events have run
                assert app.state.db_engine == mock_engine
                mock_engine.dispose.assert_not_called()

            # Shutdown events have run
            mock_engine.dispose.assert_called_once()


class TestTryDeleteStep:
    """Cover the per-store error-tolerance contract that _try_delete_step
    exists to provide: a failing store records its error on DeletionResult
    and the orchestrator continues to the next store. A regression that
    drops the try/except (or re-raises) would silently flip
    partial-success-then-500 to immediate-500 — important to pin down."""

    def test_records_failure_on_result_and_does_not_raise(self):
        from stravapipe.cloudrun.deletion_service_app import (
            DeletionResult,
            _try_delete_step,
        )

        result = DeletionResult(user_id="user-123")

        def boom() -> None:
            raise RuntimeError("connection refused")

        _try_delete_step(
            result,
            tracer=None,
            deletion_hist=None,
            store_name="postgres",
            work=boom,
        )

        assert result.errors == ["postgres: connection refused"]
        assert result.has_errors is True

    def test_success_path_leaves_errors_empty(self):
        from stravapipe.cloudrun.deletion_service_app import (
            DeletionResult,
            _try_delete_step,
        )

        result = DeletionResult(user_id="user-123")
        called = []

        def work() -> None:
            called.append(True)

        _try_delete_step(
            result,
            tracer=None,
            deletion_hist=None,
            store_name="postgres",
            work=work,
        )

        assert called == [True]
        assert result.errors == []
