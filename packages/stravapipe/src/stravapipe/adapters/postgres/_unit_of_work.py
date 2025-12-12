"""SQLAlchemy Unit of Work implementation.

Manages database sessions and coordinates repository transactions.
"""

from collections.abc import Callable
from typing import Self

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.postgres._repository import SqlAlchemyActivityRepository
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork


def create_session_factory(database_url: str) -> sessionmaker[Session]:
    """Create a session factory from database URL.

    Args:
        database_url: PostgreSQL connection string
            e.g., "postgresql+psycopg://user:pass@host:port/dbname"

    Returns:
        Configured sessionmaker bound to the engine
    """
    engine = create_engine(database_url)
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
        self._session = self._session_factory()
        # Initialize repository with the session
        self.activities = SqlAlchemyActivityRepository(self._session)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Clean up session on exit. Rollback if not committed."""
        if self._session:
            self.rollback()
            self._session.close()

    def commit(self) -> None:
        """Commit the current transaction."""
        if self._session:
            self._session.commit()

    def rollback(self) -> None:
        """Rollback the current transaction."""
        if self._session:
            self._session.rollback()
