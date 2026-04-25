"""SQLAlchemy Unit of Work implementation.

Manages database sessions and coordinates repository transactions.
"""

from collections.abc import Callable
import logging
from types import TracebackType
from typing import Literal, Self

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool, QueuePool

from stravapipe.adapters.postgres._connection import PoolConfig
from stravapipe.adapters.postgres._repository import SqlAlchemyActivityRepository
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork

logger = logging.getLogger(__name__)


def create_session_factory(
    database_url: str,
    pool_config: PoolConfig | None = None,
) -> tuple[Engine, sessionmaker[Session]]:
    """Create an engine and session factory from a database URL.

    Automatically selects pooling strategy based on configuration:
    - External pooler (Neon, PgBouncer): Uses NullPool (no client-side pooling)
    - Internal pooling: Uses QueuePool with conservative settings

    Callers own the engine and must call ``engine.dispose()`` on shutdown
    to avoid pool leaks across Cloud Run revisions.

    Args:
        database_url: PostgreSQL connection string
            e.g., "postgresql+psycopg://user:pass@host:port/dbname"
        pool_config: Connection pool configuration. If None, loads from
            environment variables via PoolConfig.from_env().

    Returns:
        (engine, session_factory) — the engine so callers can dispose it,
        and a sessionmaker bound to that engine.
    """
    if pool_config is None:
        pool_config = PoolConfig.from_env()

    if pool_config.uses_external_pooler(database_url):
        # External pooler (Neon, PgBouncer, etc.) - no client-side pooling
        logger.info(
            "Using NullPool (external pooler detected)",
            extra={"strategy": pool_config.strategy},
        )
        engine = create_engine(
            database_url,
            poolclass=NullPool,
        )
    else:
        # Internal pooling - use QueuePool with conservative settings
        logger.info(
            "Using QueuePool (internal pooling)",
            extra={
                "strategy": pool_config.strategy,
                "pool_size": pool_config.pool_size,
                "max_overflow": pool_config.max_overflow,
            },
        )
        engine = create_engine(
            database_url,
            poolclass=QueuePool,
            pool_size=pool_config.pool_size,
            max_overflow=pool_config.max_overflow,
            pool_recycle=pool_config.pool_recycle,
            pool_pre_ping=pool_config.pool_pre_ping,
        )

    return engine, sessionmaker(bind=engine, expire_on_commit=False)


class SqlAlchemyUnitOfWork(AbstractUnitOfWork):
    """SQLAlchemy implementation of Unit of Work pattern.

    Manages session lifecycle and provides repository access.
    Repositories share the same session for transaction consistency.

    Usage:
        engine, session_factory = create_session_factory(database_url)
        uow = SqlAlchemyUnitOfWork(session_factory)

        try:
            with uow:
                uow.activities.upsert(activity)
                uow.commit()
        finally:
            engine.dispose()

    For testing with transaction rollback:
        # In conftest.py fixture
        connection = engine.connect()
        transaction = connection.begin()
        session = Session(bind=connection)

        uow = SqlAlchemyUnitOfWork(lambda: session)
        yield uow

        transaction.rollback()
        connection.close()
    """

    def __init__(self, session_factory: Callable[[], Session]):
        """Initialize Unit of Work with a session factory.

        Args:
            session_factory: Callable that creates SQLAlchemy sessions.
                Can be a sessionmaker or a lambda for test fixtures.
        """
        self._session_factory = session_factory
        self._session: Session | None = None

    def __enter__(self) -> Self:
        """Start a new unit of work with a fresh session."""
        if self._session is not None:
            raise RuntimeError(
                "Unit of Work already has an active session. "
                "Create a new instance or ensure previous context was exited."
            )
        self._session = self._session_factory()
        # Initialize repository with the session
        self.activities = SqlAlchemyActivityRepository(self._session)
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> Literal[False]:
        """Clean up session on exit. Rollback if not committed.

        Returns:
            False to propagate any exception that occurred in the context.
        """
        if self._session is None:
            return False

        try:
            # Rollback any uncommitted changes (no-op if already committed)
            self._session.rollback()
        finally:
            # Always close and clear the session, even if rollback fails
            self._session.close()
            self._session = None

        return False  # Don't suppress exceptions

    def commit(self) -> None:
        """Commit the current transaction."""
        if self._session is None:
            raise RuntimeError("Cannot commit: no active session")
        self._session.commit()

    def rollback(self) -> None:
        """Rollback the current transaction."""
        if self._session is None:
            raise RuntimeError("Cannot rollback: no active session")
        self._session.rollback()
