"""SQLAlchemy Unit of Work implementation.

Manages database sessions and coordinates repository transactions.
"""

import logging
from collections.abc import Callable
from typing import Self

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool, QueuePool

from stravapipe.adapters.postgres._connection import PoolConfig
from stravapipe.adapters.postgres._repository import SqlAlchemyActivityRepository
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork

logger = logging.getLogger(__name__)


def create_session_factory(
    database_url: str,
    pool_config: PoolConfig | None = None,
) -> sessionmaker[Session]:
    """Create a session factory from database URL.

    Automatically selects pooling strategy based on configuration:
    - External pooler (Neon, PgBouncer): Uses NullPool (no client-side pooling)
    - Internal pooling: Uses QueuePool with conservative settings

    Args:
        database_url: PostgreSQL connection string
            e.g., "postgresql+psycopg://user:pass@host:port/dbname"
        pool_config: Connection pool configuration. If None, loads from
            environment variables via PoolConfig.from_env().

    Returns:
        Configured sessionmaker bound to the engine
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

    return sessionmaker(bind=engine, expire_on_commit=False)


class SqlAlchemyUnitOfWork(AbstractUnitOfWork):
    """SQLAlchemy implementation of Unit of Work pattern.

    Manages session lifecycle and provides repository access.
    Repositories share the same session for transaction consistency.

    Usage:
        session_factory = create_session_factory(database_url)
        uow = SqlAlchemyUnitOfWork(session_factory)

        with uow:
            uow.activities.upsert(activity)
            uow.commit()

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

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
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
