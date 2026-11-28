"""Unit tests for deletion_service_app FastAPI endpoints."""

import base64
import json
from pathlib import Path
from unittest.mock import MagicMock, call, patch

from fastapi.testclient import TestClient
import pytest

from stravapipe.adapters.firestore.activity_connection import ConnectionConflictError
from stravapipe.application.deletion.bq_user_deletion_service import BQDeletionResult

from .conftest import make_cloudevent_headers, make_pubsub_body


def _ownership(uid: str = "app-user", subject: str = "98765") -> dict[str, str]:
    return {
        "deletion_owner_uid": uid,
        "deletion_owner_subject": subject,
        "deletion_owner_version": "1",
        "deletion_owner_provider": "strava",
    }


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
            "stravapipe.cloudrun.deletion_service_app.verify_deletion_owner"
        ) as verify_owner,
        patch(
            "stravapipe.cloudrun.deletion_service_app.delete_user_documents",
            return_value=4,
        ) as purge,
        patch(
            "stravapipe.cloudrun.deletion_service_app.BQUserDeletionService"
        ) as mock_bq_svc,
    ):
        mock_factory.return_value = (MagicMock(), mock_services["session_factory"])
        mock_bq_svc.return_value = mock_services["bq_deletion_service"]
        mock_services.update(verify_owner=verify_owner, purge=purge)

        from stravapipe.cloudrun.deletion_service_app import app

        with TestClient(app) as c:
            # `app` is a module-level singleton shared across this test
            # module (and test_trace_propagation.py). Snapshot the state
            # the lifespan just populated, then restore it on teardown so
            # the per-test overrides below — and any state a test mutates
            # itself (see TestReadyEndpoint) — don't leak into other tests.
            saved_state = {key: app.state[key] for key in app.state}

            # Override app state with our mocks
            app.state.session_factory = mock_services["session_factory"]
            app.state.bq_deletion_service = mock_services["bq_deletion_service"]
            app.state.firestore_client = mock_services["firestore_client"]
            # Override the MagicMock timeout that lifespan picked up from the
            # mocked config — asyncio.wait_for needs a real number.
            app.state.readiness_timeout = 5.0
            try:
                yield c
            finally:
                for key in list(app.state):
                    del app.state[key]
                for key, value in saved_state.items():
                    app.state[key] = value


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
    @pytest.mark.parametrize("aspect_type", ["update", "delete"])
    @pytest.mark.parametrize("uid", ["98765", "app-user"])
    def test_successful_deletion(self, client, mock_services, uid, aspect_type):
        """Full deletion across all stores returns 200."""
        # Mock BQ deletion
        mock_services["bq_deletion_service"].run.return_value = BQDeletionResult(
            activities_deleted=3,
            staging_deleted=1,
            live_deleted=2,
        )

        # Mock UoW context manager
        mock_uow = MagicMock()
        mock_uow.__enter__ = MagicMock(return_value=mock_uow)
        mock_uow.__exit__ = MagicMock(return_value=False)
        mock_uow.activities.delete_by_user.return_value = 3

        fixture_path = (
            Path(__file__).parents[5] / "schemas/test-fixtures/deletion_ownership.json"
        )
        if not fixture_path.exists():
            fixture_path = Path("test-fixtures/deletion_ownership.json")
        fixture = json.loads(fixture_path.read_text())
        payload, attributes = fixture["event"], fixture["attributes"]
        payload["aspect_type"] = aspect_type
        attributes["deletion_owner_uid"] = uid

        with patch(
            "stravapipe.cloudrun.deletion_service_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post(
                "/",
                headers=make_cloudevent_headers(),
                json=make_pubsub_body(payload, attributes=attributes),
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "deleted"
        assert data["user_id"] == uid
        assert data["pg_deleted"] == 3
        assert data["bq_activities_deleted"] == 3
        assert data["bq_staging_deleted"] == 1
        mock_uow.activities.delete_by_user.assert_called_once_with(uid)
        mock_services["bq_deletion_service"].run.assert_called_once_with(
            "98765", data["correlation_id"], payload["event_time"]
        )
        mock_services["verify_owner"].assert_called_once_with(
            mock_services["firestore_client"], uid, "98765"
        )
        mock_services["purge"].assert_called_once_with(
            mock_services["firestore_client"], uid, "98765"
        )

    def test_missing_owner_id_returns_422(self, client):
        """Event without owner_id returns 422."""
        payload = _make_deauth_payload()
        del payload["owner_id"]

        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(payload, attributes=_ownership()),
        )

        assert response.status_code == 422
        assert "owner_id" in response.json()["detail"]

    @pytest.mark.parametrize(
        "attributes",
        [
            None,
            {"deletion_owner_uid": "app-user"},
            _ownership(uid="invalid/path"),
            _ownership(subject="098765"),
            _ownership(subject="98766"),
            {**_ownership(), "deletion_owner_version": "2"},
            {**_ownership(), "deletion_owner_provider": "other"},
        ],
    )
    def test_invalid_binding_skips_all_stores(self, client, mock_services, attributes):
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(_make_deauth_payload(), attributes=attributes),
        )
        assert response.status_code == 422
        mock_services["verify_owner"].assert_not_called()
        mock_services["session_factory"].assert_not_called()
        mock_services["bq_deletion_service"].run.assert_not_called()
        mock_services["purge"].assert_not_called()

    def test_remapped_owner_skips_all_writes(self, client, mock_services):
        mock_services["verify_owner"].side_effect = ConnectionConflictError("remapped")
        response = client.post(
            "/",
            headers=make_cloudevent_headers(),
            json=make_pubsub_body(_make_deauth_payload(), attributes=_ownership()),
        )
        assert response.status_code == 409
        mock_services["session_factory"].assert_not_called()
        mock_services["bq_deletion_service"].run.assert_not_called()
        mock_services["purge"].assert_not_called()

    def test_non_object_payload_returns_422(self, client, mock_services):
        body = make_pubsub_body(_make_deauth_payload(), attributes=_ownership())
        body["message"]["data"] = base64.b64encode(b"[]").decode()
        response = client.post("/", headers=make_cloudevent_headers(), json=body)
        assert response.status_code == 422
        mock_services["verify_owner"].assert_not_called()

    def test_missing_cloudevent_headers_returns_400(self, client):
        response = client.post(
            "/",
            json=make_pubsub_body(_make_deauth_payload()),
        )
        assert response.status_code == 400

    @pytest.mark.parametrize("failed_store", ["postgres", "bigquery", "firestore_docs"])
    def test_partial_failure_retries_the_captured_owner(
        self, client, mock_services, failed_store
    ):
        """Every retry uses the same pair, even when Firestore already completed."""
        mock_uow = MagicMock()
        mock_uow.__enter__ = MagicMock(return_value=mock_uow)
        mock_uow.__exit__ = MagicMock(return_value=False)
        mock_uow.activities.delete_by_user.return_value = 0
        bq = mock_services["bq_deletion_service"].run
        bq.return_value = BQDeletionResult(0, 0, 0)
        failed = {
            "postgres": mock_uow.activities.delete_by_user,
            "bigquery": bq,
            "firestore_docs": mock_services["purge"],
        }[failed_store]
        failed.side_effect = RuntimeError("store unavailable")
        body = make_pubsub_body(_make_deauth_payload(), attributes=_ownership())

        with patch(
            "stravapipe.cloudrun.deletion_service_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            response = client.post("/", headers=make_cloudevent_headers(), json=body)
            failed.side_effect = None
            retry = client.post("/", headers=make_cloudevent_headers(), json=body)

        assert response.status_code == 500
        assert failed_store in response.json()["detail"]
        assert retry.status_code == 200
        assert (
            mock_uow.activities.delete_by_user.call_args_list == [call("app-user")] * 2
        )
        assert [c.args[0] for c in bq.call_args_list] == ["98765"] * 2
        assert (
            mock_services["purge"].call_args_list
            == [call(mock_services["firestore_client"], "app-user", "98765")] * 2
        )


class TestIdempotency:
    """Idempotency: redelivery of the same deauth event must not corrupt state."""

    def test_deletion_idempotent_on_redelivery(self, client, mock_services):
        """Second delivery returns 200 with zero counts — nothing left to delete.

        Store delete operations are idempotent: PG/BQ DELETEs of
        already-deleted rows return 0 rows affected; Firestore .delete() is
        a no-op on missing documents.
        """
        # First call: data exists; second call: nothing left.
        mock_services["bq_deletion_service"].run.side_effect = [
            BQDeletionResult(activities_deleted=3, staging_deleted=1, live_deleted=2),
            BQDeletionResult(activities_deleted=0, staging_deleted=0, live_deleted=0),
        ]

        mock_uow = MagicMock()
        mock_uow.__enter__ = MagicMock(return_value=mock_uow)
        mock_uow.__exit__ = MagicMock(return_value=False)
        mock_uow.activities.delete_by_user.side_effect = [3, 0]

        with patch(
            "stravapipe.cloudrun.deletion_service_app.SqlAlchemyUnitOfWork",
            return_value=mock_uow,
        ):
            body = make_pubsub_body(_make_deauth_payload(), attributes=_ownership())
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
