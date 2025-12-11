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
        # Initialize repositories with the session
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


class FakeUnitOfWork(AbstractUnitOfWork):
    """In-memory Unit of Work for unit testing.

    Provides a fake implementation that stores activities in memory
    without requiring a database connection.

    Usage:
        uow = FakeUnitOfWork()
        with uow:
            uow.activities.upsert(activity)
            uow.commit()

        assert uow.committed
        assert len(uow.activities.activities) == 1
    """

    def __init__(self):
        self.activities = FakeActivityRepository()
        self.committed = False

    def __enter__(self) -> Self:
        self.committed = False
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass  # No rollback needed for in-memory

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        pass  # No rollback needed for in-memory


class FakeActivityRepository:
    """In-memory activity repository for testing."""

    def __init__(self):
        self.activities: dict[int, dict] = {}

    def upsert(self, activity) -> dict:
        """Store activity in memory dict."""
        was_insert = activity.id not in self.activities
        self.activities[activity.id] = {
            "id": activity.id,
            "user_id": activity.user_id,
            "name": activity.name,
            "type": activity.type,
            "sport": activity.sport,
            "start_date_local": activity.start_date_local,
            "distance": activity.distance,
            "moving_time": activity.moving_time,
            "elapsed_time": activity.elapsed_time,
            "total_elevation_gain": activity.total_elevation_gain,
            "average_speed": activity.average_speed,
            "max_speed": activity.max_speed,
            "average_heartrate": activity.average_heartrate,
            "max_heartrate": activity.max_heartrate,
            "year": activity.year,
        }
        return {"inserted": was_insert}

    def delete(self, activity_id: int) -> bool:
        """Remove activity from memory dict."""
        if activity_id in self.activities:
            del self.activities[activity_id]
            return True
        return False

    def get_by_id(self, activity_id: int):
        """Get activity from memory dict."""
        return self.activities.get(activity_id)

    def get_by_user_and_year(self, user_id: str, year: int) -> list:
        """Get activities by user and year from memory dict."""
        return [
            a for a in self.activities.values()
            if a["user_id"] == user_id and a["year"] == year
        ]

    def exists(self, activity_id: int) -> bool:
        """Check if activity exists in memory dict."""
        return activity_id in self.activities
