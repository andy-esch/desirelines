"""SQLAlchemy Unit of Work implementation.

Manages database sessions and coordinates repository transactions.
"""

from collections.abc import Callable
import logging
from types import TracebackType
from typing import Literal, Self

from opentelemetry.trace import Tracer
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool, QueuePool

from stravapipe.adapters.postgres._connection import PoolConfig
from stravapipe.adapters.postgres._repository import SqlAlchemyActivityRepository
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork
from stravapipe.shared.tracing import record_span

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

    **Cold-start cost invariant**: this function MUST NOT open a connection
    to Postgres. SQLAlchemy ``create_engine()`` is lazy by default, and
    NullPool (used for Neon) never pre-opens. Do NOT add a "verify
    connectivity" call here — every Cloud Run cold start would then wake
    Neon's compute for the full 5-min idle window, exactly the trap that
    `packages/apigateway/adapters/postgres/pool.go:69-74` calls out. The
    hourly Cloud Scheduler ``/ready`` probe is the canary; rely on it.

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

    def __init__(
        self,
        session_factory: Callable[[], Session],
        *,
        tracer: Tracer | None = None,
    ):
        """Initialize Unit of Work with a session factory.

        Args:
            session_factory: Callable that creates SQLAlchemy sessions.
                Can be a sessionmaker or a lambda for test fixtures.
            tracer: Optional OTel tracer. When set, ``__enter__`` and ``commit``
                emit ``postgres.session.acquire`` and ``postgres.commit`` spans
                so connection-checkout and commit latency are visible
                independently in distributed traces.
        """
        self._session_factory = session_factory
        self._session: Session | None = None
        self._tracer = tracer

    def __enter__(self) -> Self:
        """Start a new unit of work with a fresh session."""
        if self._session is not None:
            raise RuntimeError(
                "Unit of Work already has an active session. "
                "Create a new instance or ensure previous context was exited."
            )
        # session_factory() may block on connection-pool checkout under
        # contention; recording the span here exposes that wait separately
        # from the actual SQL work that follows.
        with record_span(self._tracer, "postgres.session.acquire"):
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
            try:
                self._session.close()
            finally:
                # Do not retain a failed/closed session if close itself raises.
                self._session = None

        return False  # Don't suppress exceptions

    def commit(self) -> None:
        """Commit the current transaction.

        A normal return confirms success to the application. An exception is
        not proof of rollback because the connection can fail after PostgreSQL
        accepts the commit; callers must treat that outcome as ambiguous.
        """
        if self._session is None:
            raise RuntimeError("Cannot commit: no active session")
        # commit() blocks until the WAL flush returns; instrumenting it
        # surfaces commit-time latency (e.g. replication lag) separately
        # from the INSERT/UPDATE work that preceded it.
        with record_span(self._tracer, "postgres.commit"):
            self._session.commit()

    def rollback(self) -> None:
        """Rollback the current transaction."""
        if self._session is None:
            raise RuntimeError("Cannot rollback: no active session")
        self._session.rollback()
