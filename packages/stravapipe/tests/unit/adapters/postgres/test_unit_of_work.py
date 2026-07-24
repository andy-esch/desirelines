"""Unit tests for SQLAlchemy Unit of Work session cleanup."""

import logging
from unittest.mock import MagicMock, patch

from opentelemetry.trace import Tracer
import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from stravapipe.adapters.postgres._unit_of_work import SqlAlchemyUnitOfWork


def _tracer_with_span(
    *,
    enter_error: Exception | None = None,
    exit_error: Exception | None = None,
) -> tuple[MagicMock, MagicMock, MagicMock]:
    tracer = MagicMock(spec=Tracer)
    span = MagicMock()
    span_context = MagicMock()
    if enter_error is None:
        span_context.__enter__.return_value = span
    else:
        span_context.__enter__.side_effect = enter_error
    if exit_error is not None:
        span_context.__exit__.side_effect = exit_error
    tracer.start_as_current_span.return_value = span_context
    return tracer, span, span_context


def _entered_uow(
    session: MagicMock,
    *,
    tracer: MagicMock | None = None,
) -> SqlAlchemyUnitOfWork:
    uow = SqlAlchemyUnitOfWork(lambda: session, tracer=tracer)
    uow.__enter__()
    return uow


def test_commit_tracing_teardown_failure_does_not_change_success(
    caplog: pytest.LogCaptureFixture,
):
    """A span-exit failure after commit cannot report durable success as failure."""
    session = MagicMock(spec=Session)
    tracer, _, span_context = _tracer_with_span(
        exit_error=RuntimeError("span teardown failed")
    )
    uow = _entered_uow(session, tracer=tracer)
    span_context.reset_mock()
    span_context.__exit__.side_effect = RuntimeError("span teardown failed")

    with caplog.at_level(logging.WARNING):
        uow.commit()

    session.commit.assert_called_once_with()
    span_context.__exit__.assert_called_once_with(None, None, None)
    assert "operation outcome preserved" in caplog.text


def test_commit_failure_wins_over_tracing_error_and_rolls_back():
    """Tracing error recording cannot replace the original database exception."""
    session = MagicMock(spec=Session)
    database_error = OperationalError(
        "COMMIT",
        {},
        RuntimeError("database unavailable"),
    )
    session.commit.side_effect = database_error
    tracer, span, _ = _tracer_with_span()
    span.set_status.side_effect = RuntimeError("span status failed")
    uow = SqlAlchemyUnitOfWork(lambda: session, tracer=tracer)

    with pytest.raises(OperationalError) as caught, uow:
        uow.commit()

    assert caught.value is database_error
    session.commit.assert_called_once_with()
    session.rollback.assert_called_once_with()
    session.close.assert_called_once_with()


def test_commit_uses_normal_tracing_path():
    """Normal tracing brackets one successful commit."""
    session = MagicMock(spec=Session)
    tracer, _, span_context = _tracer_with_span()
    uow = _entered_uow(session, tracer=tracer)
    tracer.reset_mock()
    span_context.reset_mock()

    uow.commit()

    tracer.start_as_current_span.assert_called_once_with("postgres.commit")
    span_context.__enter__.assert_called_once_with()
    span_context.__exit__.assert_called_once_with(None, None, None)
    session.commit.assert_called_once_with()


def test_commit_runs_once_when_tracing_setup_fails():
    """Span creation failure cannot skip or duplicate the database commit."""
    session = MagicMock(spec=Session)
    tracer, _, _ = _tracer_with_span(enter_error=RuntimeError("span creation failed"))
    uow = SqlAlchemyUnitOfWork(lambda: session, tracer=tracer)
    uow._session = session

    uow.commit()

    session.commit.assert_called_once_with()


def test_session_acquisition_survives_tracing_teardown_failure():
    """A session remains usable when its acquisition span cannot close."""
    session = MagicMock(spec=Session)
    session_factory = MagicMock(return_value=session)
    tracer, _, _ = _tracer_with_span(exit_error=RuntimeError("span teardown failed"))
    uow = SqlAlchemyUnitOfWork(session_factory, tracer=tracer)

    entered = uow.__enter__()

    assert entered is uow
    assert uow._session is session
    session_factory.assert_called_once_with()


def test_logging_failure_does_not_resurface_tracing_failure():
    """Broken warning handlers cannot turn a successful commit into failure."""
    session = MagicMock(spec=Session)
    tracer, _, span_context = _tracer_with_span()
    uow = _entered_uow(session, tracer=tracer)
    span_context.__exit__.side_effect = RuntimeError("span teardown failed")

    with patch(
        "stravapipe.shared.tracing.logger.warning",
        side_effect=RuntimeError("logging failed"),
    ):
        uow.commit()

    session.commit.assert_called_once_with()


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
