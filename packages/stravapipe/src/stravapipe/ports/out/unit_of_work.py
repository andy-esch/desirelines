"""Unit of Work port for transaction management.

The Unit of Work pattern coordinates multiple repository operations within
a single transaction. Repositories don't manage their own sessions - they
receive a session from the Unit of Work.

This enables:
- Atomic operations across multiple tables (e.g., activities + geospatial)
- Explicit commit/rollback control
- Easy testing via transaction rollback
"""

from abc import ABC, abstractmethod
from types import TracebackType
from typing import TYPE_CHECKING, Self

if TYPE_CHECKING:
    from stravapipe.ports.out.postgres import ActivityRepository


class AbstractUnitOfWork(ABC):
    """Abstract Unit of Work for PostgreSQL transaction management.

    Usage:
        with uow:
            uow.activities.upsert(activity)
            uow.commit()  # Explicit commit required

    If no commit is called, rollback happens automatically on __exit__.
    """

    activities: "ActivityRepository"

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> bool | None:
        self.rollback()
        return None

    @abstractmethod
    def commit(self) -> None:
        """Commit the current transaction.

        Returning means callers may treat the transaction as committed. Raising
        does not prove the database rejected it: a connection failure can occur
        after the server accepted the commit, leaving the outcome ambiguous.
        """
        raise NotImplementedError

    @abstractmethod
    def rollback(self) -> None:
        """Rollback the current transaction."""
        raise NotImplementedError
