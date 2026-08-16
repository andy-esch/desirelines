"""SQLAlchemy Unit of Work implementation.

Manages database sessions and coordinates repository transactions.
"""

from collections.abc import Callable
from functools import partial
import logging
from types import TracebackType
from typing import Literal, Self

from opentelemetry.trace import Tracer
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from sqlalchemy.pool import NullPool, QueuePool

from stravapipe.adapters.postgres._connection import PoolConfig
from stravapipe.adapters.postgres._repository import SqlAlchemyActivityRepository
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork
from stravapipe.shared.logging import log_best_effort
from stravapipe.shared.tracing import record_span

logger = logging.getLogger(__name__)


def _report_session_cleanup_failure(
    operation: str,
    error: Exception,
    *,
    preserved_outcome: str,
) -> None:
    """Report cleanup failure without risking the transaction outcome."""
    log_best_effort(
        partial(
            logger.warning,
            "PostgreSQL session %s failed (%s); %s",
            operation,
            type(error).__name__,
            preserved_outcome,
            exc_info=(type(error), error, error.__traceback__),
        )
    )


def _register_transaction_timeouts(
    session_factory: sessionmaker[Session],
    settings: tuple[tuple[str, str], ...],
) -> None:
    """Apply the server-side timeouts with ``SET LOCAL`` on each transaction.

    Two constraints rule out the alternatives, both imposed by connection
    pooling in front of Postgres (Neon's pooled endpoint, PgBouncer, pgpool):

    * Not the libpq startup packet. A pooler only forwards the handful of
      parameters it can track — ``client_encoding``, ``datestyle``,
      ``timezone``, ``standard_conforming_strings``, ``application_name`` — and
      rejects the connection outright for the rest. The failure is a total
      outage at connect time, not a lost setting.
    * Not a plain ``SET`` at connect time. Under transaction pooling the server
      connection is handed back to the pooler at commit, so the setting both
      fails to persist for this client and leaks onto whichever client picks up
      that connection next.

    ``SET LOCAL`` is scoped to the transaction, which is exactly the window a
    pooler guarantees is served by one server connection. Every GUC goes in a
    single ``SELECT set_config(...)`` so the guarantee costs one round trip per
    transaction, and names and values are bound rather than interpolated.

    Listening on the factory rather than the ``Session`` class leaves test
    fixtures that bind their own session alone.
    """
    if not settings:
        return

    calls: list[str] = []
    params: dict[str, str] = {}
    for index, (name, value) in enumerate(settings):
        calls.append(f"set_config(:name_{index}, :value_{index}, true)")
        params[f"name_{index}"] = name
        params[f"value_{index}"] = value
    statement = text(f"SELECT {', '.join(calls)}")

    @event.listens_for(session_factory, "after_begin")
    def _apply_transaction_timeouts(
        session: Session,
        transaction: SessionTransaction,
        connection: Connection,
    ) -> None:
        # after_begin also fires for every SAVEPOINT, which inherits the
        # enclosing transaction's SET LOCAL and restores it on release. Writing
        # it again would be one wasted round trip per savepoint — and the
        # region-tagging path opens one per activity, so a 100-activity backfill
        # batch would pay ~100 of them for a single unit of work.
        if transaction.nested:
            return
        connection.execute(statement, params)


def create_session_factory(
    database_url: str,
    pool_config: PoolConfig | None = None,
) -> tuple[Engine, sessionmaker[Session]]:
    """Create an engine and session factory from a database URL.

    Automatically selects pooling strategy based on configuration:
    - External pooler (Neon, PgBouncer): Uses NullPool (no client-side pooling)
    - Internal pooling: Uses QueuePool with conservative settings

    Sessions from the returned factory apply ``pool_config``'s server-side
    timeouts per transaction; see ``_register_transaction_timeouts``.

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

    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    _register_transaction_timeouts(
        session_factory, pool_config.session_timeout_settings()
    )
    return engine, session_factory


class SqlAlchemyUnitOfWork(AbstractUnitOfWork):
    """SQLAlchemy implementation of Unit of Work pattern.

    Manages session lifecycle and provides repository access.
    Repositories share the same session for transaction consistency.

    Transaction outcome precedence is explicit:

    * Once ``commit()`` returns, later session cleanup is best effort and cannot
      change the durable success reported to the caller.
    * When the context body or ``commit()`` raises, that original exception
      remains authoritative even if rollback or close also fails.
    * Without a successful commit or an existing exception, a cleanup failure
      is the operation's only failure and the first such failure propagates
      after all cleanup has been attempted.

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
        self._commit_succeeded = False

    def __enter__(self) -> Self:
        """Start a new unit of work with a fresh session."""
        if self._session is not None:
            raise RuntimeError(
                "Unit of Work already has an active session. "
                "Create a new instance or ensure previous context was exited."
            )
        self._commit_succeeded = False
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
        """Clean up the session without replacing an authoritative outcome.

        Returns:
            False to propagate any exception that occurred in the context.
        """
        if self._session is None:
            return False

        session = self._session
        commit_succeeded = self._commit_succeeded
        cleanup_errors: list[tuple[str, Exception]] = []

        try:
            if not commit_succeeded:
                try:
                    session.rollback()
                except Exception as rollback_error:
                    cleanup_errors.append(("rollback", rollback_error))

            try:
                session.close()
            except Exception as close_error:
                cleanup_errors.append(("close", close_error))
        finally:
            # A failed/closed session must never leave the reusable UoW active.
            self._session = None
            self._commit_succeeded = False

        if not cleanup_errors:
            return False

        if exc_val is not None:
            preserved_outcome = "original transaction exception preserved"
        elif commit_succeeded:
            preserved_outcome = "committed transaction outcome preserved"
        else:
            preserved_outcome = "cleanup failure is the transaction outcome"

        for operation, cleanup_error in cleanup_errors:
            _report_session_cleanup_failure(
                operation,
                cleanup_error,
                preserved_outcome=preserved_outcome,
            )

        if exc_val is None and not commit_succeeded:
            raise cleanup_errors[0][1]

        return False

    def commit(self) -> None:
        """Commit the current transaction.

        A normal return confirms success to the application. An exception is
        not proof of rollback because the connection can fail after PostgreSQL
        accepts the commit; callers must treat that outcome as ambiguous.
        """
        if self._session is None:
            raise RuntimeError("Cannot commit: no active session")
        # Reset before each attempt so a later failed commit cannot inherit a
        # successful outcome from an earlier transaction on the same session.
        self._commit_succeeded = False
        # commit() blocks until the WAL flush returns; instrumenting it
        # surfaces commit-time latency (e.g. replication lag) separately
        # from the INSERT/UPDATE work that preceded it.
        with record_span(self._tracer, "postgres.commit"):
            self._session.commit()
        self._commit_succeeded = True

    def rollback(self) -> None:
        """Rollback the current transaction."""
        if self._session is None:
            raise RuntimeError("Cannot rollback: no active session")
        self._commit_succeeded = False
        self._session.rollback()
