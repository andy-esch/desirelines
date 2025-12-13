"""Integration test fixtures with transaction rollback.

Provides fast, isolated database tests by wrapping each test in a transaction
that rolls back automatically. No cleanup queries needed.

Usage:
    pytest tests/integration/ --db-url="postgresql+psycopg://..."

Or set POSTGRES_TEST_CONNECTION_STRING environment variable.
"""

import os

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session

from stravapipe.adapters.postgres import (
    SqlAlchemyActivityRepository,
)
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork


def pytest_addoption(parser):
    """Add --db-url command line option."""
    parser.addoption(
        "--db-url",
        action="store",
        default=None,
        help="PostgreSQL connection string for integration tests",
    )


@pytest.fixture(scope="session")
def db_url(request):
    """Get database URL from CLI or environment."""
    url = request.config.getoption("--db-url")
    if url:
        return url

    url = os.environ.get("POSTGRES_TEST_CONNECTION_STRING")
    if url:
        return url

    # Default for local docker-compose
    return "postgresql+psycopg://desirelines:local_dev_password@localhost:15430/desirelines_local"


@pytest.fixture(scope="session")
def engine(db_url):
    """Create engine once for entire test session."""
    engine = create_engine(db_url, echo=False, pool_pre_ping=True)

    # Verify connection works
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))

    return engine


@pytest.fixture
def db_session(engine):
    """Each test gets its own transaction that rolls back automatically.

    This is THE key to fast integration tests - no cleanup queries needed.
    """
    connection = engine.connect()
    transaction = connection.begin()

    # Key: Bind session to connection (not engine) for transaction control
    session = Session(bind=connection, expire_on_commit=False)

    # Handle nested transactions (savepoints) when code calls commit/rollback
    nested = connection.begin_nested()

    @event.listens_for(session, "after_transaction_end")
    def restart_savepoint(session, trans):
        nonlocal nested
        if trans.nested and not trans.parent.nested:
            # Restart savepoint after commit
            nested = connection.begin_nested()

    yield session

    # Cleanup - rollback everything (no DELETE needed)
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def uow(db_session) -> AbstractUnitOfWork:
    """Unit of Work that uses test session with transaction rollback."""

    class TestUnitOfWork(AbstractUnitOfWork):
        """Test UoW using provided session instead of creating one."""

        def __init__(self, session: Session):
            self._session = session
            self._activities = SqlAlchemyActivityRepository(session)

        @property
        def activities(self):
            return self._activities

        def __enter__(self):
            return self

        def __exit__(self, *args):
            # Don't close session or rollback - fixture manages it
            pass

        def commit(self):
            self._session.commit()

        def rollback(self):
            self._session.rollback()

    return TestUnitOfWork(db_session)


@pytest.fixture
def session_factory(db_session):
    """Session factory that returns the test session."""
    return lambda: db_session
