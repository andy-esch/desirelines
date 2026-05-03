"""Regression test: FastAPI lifespan must NOT open a Postgres connection.

The apigateway burned Neon compute hours early on because pool construction
was eager — every Cloud Run cold start woke Neon for the full 5-min idle
window. Python is currently safe because `create_session_factory()` uses
SQLAlchemy `create_engine()` which is lazy by default (and NullPool for
Neon never pre-opens), but a future refactor could regress that.

These tests substitute SQLAlchemy's `create_engine` with a fake that
records every `connect()` invocation, drive each app's lifespan to the
`yield` point via FastAPI's TestClient, and assert zero connections were
opened. If a future change adds an eager `engine.connect()` or
`SELECT 1` inside lifespan, these fail loudly — before the new hourly
Cloud Scheduler probes amplify the cost across every cold start.
"""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest


class _ConnectCountingEngine:
    """Stand-in for a SQLAlchemy Engine.

    Counts `connect()` calls so a regression that adds eager connectivity
    inside lifespan trips the assertion. Other Engine attributes return
    MagicMocks via `__getattr__` so `sessionmaker(bind=engine)` (which
    only stores the reference) doesn't blow up.
    """

    def __init__(self):
        self.connect_calls = 0
        self._mock = MagicMock()

    def connect(self, *args, **kwargs):
        self.connect_calls += 1
        return MagicMock()

    def dispose(self, *args, **kwargs):
        # Engine.dispose() does not open a connection, but it IS called by
        # lifespan's finally branch — count nothing here, just no-op.
        return None

    def __getattr__(self, name):
        return getattr(self._mock, name)


@pytest.fixture
def fake_engine():
    """A fresh _ConnectCountingEngine per test."""
    return _ConnectCountingEngine()


def _patch_create_engine(fake_engine: _ConnectCountingEngine):
    """Patch SQLAlchemy `create_engine` at the import site used by
    `create_session_factory`. Returns the engine wrapper so the test
    can read `.connect_calls` after the lifespan finishes."""
    return patch(
        "stravapipe.adapters.postgres._unit_of_work.create_engine",
        return_value=fake_engine,
    )


def test_postgres_writer_lifespan_does_not_open_connection(fake_engine):
    """postgres_writer_app lifespan must not connect to Postgres at startup."""
    with (
        patch(
            "stravapipe.cloudrun.postgres_writer_app.load_postgres_writer_config"
        ) as mock_config,
        _patch_create_engine(fake_engine),
    ):
        mock_config.return_value = MagicMock(
            postgres_connection_string="postgresql://user:pass@host-pooler:5432/db"
        )

        from stravapipe.cloudrun.postgres_writer_app import app

        with TestClient(app):
            # Entering the context drives lifespan to its `yield`. Any
            # eager connectivity would happen by now — the assertion holds
            # whether a probe is sent or not.
            pass

        assert fake_engine.connect_calls == 0, (
            f"postgres_writer lifespan opened {fake_engine.connect_calls} "
            "Postgres connection(s) at startup — this re-introduces the "
            "cold-start Neon wake bug that the apigateway pool fix called "
            "out. Keep engine construction lazy."
        )


def test_deletion_service_lifespan_does_not_open_connection(fake_engine):
    """deletion_service_app lifespan must not connect to Postgres at startup."""
    with (
        patch(
            "stravapipe.cloudrun.deletion_service_app.load_deletion_service_config"
        ) as mock_config,
        patch("stravapipe.cloudrun.deletion_service_app.BigQueryClientWrapper"),
        patch("stravapipe.cloudrun.deletion_service_app.FirestoreClient"),
        patch("stravapipe.cloudrun.deletion_service_app.BQUserDeletionService"),
        patch("stravapipe.cloudrun.deletion_service_app.FirestoreTokenStore"),
        _patch_create_engine(fake_engine),
    ):
        mock_config.return_value = MagicMock(
            postgres_connection_string="postgresql://user:pass@host-pooler:5432/db",
            project_id="test-project",
            bq_dataset="test_dataset",
            firestore_database="(default)",
        )

        from stravapipe.cloudrun.deletion_service_app import app

        with TestClient(app):
            pass

        assert fake_engine.connect_calls == 0, (
            f"deletion_service lifespan opened {fake_engine.connect_calls} "
            "Postgres connection(s) at startup — this re-introduces the "
            "cold-start Neon wake bug that the apigateway pool fix called "
            "out. Keep engine construction lazy."
        )
