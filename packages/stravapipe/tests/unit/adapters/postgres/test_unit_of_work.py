"""Unit tests for SQLAlchemy Unit of Work session cleanup."""

from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from stravapipe.adapters.postgres._unit_of_work import SqlAlchemyUnitOfWork


def _entered_uow(session: MagicMock) -> SqlAlchemyUnitOfWork:
    uow = SqlAlchemyUnitOfWork(lambda: session)
    uow.__enter__()
    return uow


def test_exit_closes_and_clears_session_when_rollback_fails():
    """A rollback exception cannot skip close or retain the failed session."""
    session = MagicMock(spec=Session)
    session.rollback.side_effect = RuntimeError("rollback failed")
    uow = _entered_uow(session)

    with pytest.raises(RuntimeError, match="rollback failed"):
        uow.__exit__(None, None, None)

    session.close.assert_called_once_with()
    assert uow._session is None


def test_exit_clears_session_when_close_fails():
    """A close exception propagates without leaving the UoW permanently active."""
    session = MagicMock(spec=Session)
    session.close.side_effect = RuntimeError("close failed")
    uow = _entered_uow(session)

    with pytest.raises(RuntimeError, match="close failed"):
        uow.__exit__(None, None, None)

    session.rollback.assert_called_once_with()
    assert uow._session is None
