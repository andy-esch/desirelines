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

    # `context=None` is passed explicitly rather than omitted; it is what
    # start_as_current_span already defaults to, so the two are equivalent
    # against the real API — only the mock sees the difference.
    tracer.start_as_current_span.assert_called_once_with(
        "postgres.commit", context=None
    )
    span_context.__enter__.assert_called_once_with()
    span_context.__exit__.assert_called_once_with(None, None, None)
    session.commit.assert_called_once_with()


def test_successful_commit_skips_rollback_and_closes_session():
    """A returned commit is authoritative and needs only session release."""
    session = MagicMock(spec=Session)
    uow = SqlAlchemyUnitOfWork(lambda: session)

    with uow:
        uow.commit()

    session.commit.assert_called_once_with()
    session.rollback.assert_not_called()
    session.close.assert_called_once_with()
    assert uow._session is None


def test_close_failure_after_successful_commit_is_fail_open(
    caplog: pytest.LogCaptureFixture,
):
    """Session release cannot turn an acknowledged commit into failure."""
    session = MagicMock(spec=Session)
    session.close.side_effect = RuntimeError("close failed")
    uow = SqlAlchemyUnitOfWork(lambda: session)

    with caplog.at_level(logging.WARNING), uow:
        uow.commit()

    session.rollback.assert_not_called()
    session.close.assert_called_once_with()
    assert uow._session is None
    assert "committed transaction outcome preserved" in caplog.text


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


def test_cleanup_logging_failure_does_not_resurface_close_failure_after_commit():
    """Broken warning handlers cannot replace a successful commit."""
    session = MagicMock(spec=Session)
    session.close.side_effect = RuntimeError("close failed")
    uow = SqlAlchemyUnitOfWork(lambda: session)

    with (
        patch(
            "stravapipe.adapters.postgres._unit_of_work.logger.warning",
            side_effect=RuntimeError("logging failed"),
        ),
        uow,
    ):
        uow.commit()

    session.commit.assert_called_once_with()
    session.close.assert_called_once_with()
    assert uow._session is None


def test_body_exception_identity_wins_over_rollback_and_close_failures(
    caplog: pytest.LogCaptureFixture,
):
    """Cleanup failures cannot replace the context body's exception."""
    session = MagicMock(spec=Session)
    session.rollback.side_effect = RuntimeError("rollback failed")
    session.close.side_effect = RuntimeError("close failed")
    body_error = ValueError("repository failed")
    uow = SqlAlchemyUnitOfWork(lambda: session)

    with (
        caplog.at_level(logging.WARNING),
        pytest.raises(ValueError, match="repository failed") as caught,
        uow,
    ):
        raise body_error

    assert caught.value is body_error
    session.rollback.assert_called_once_with()
    session.close.assert_called_once_with()
    assert uow._session is None
    assert caplog.text.count("original transaction exception preserved") == 2


def test_commit_exception_identity_wins_over_rollback_and_close_failures(
    caplog: pytest.LogCaptureFixture,
):
    """An ambiguous commit error remains authoritative during cleanup."""
    session = MagicMock(spec=Session)
    commit_error = OperationalError(
        "COMMIT",
        {},
        RuntimeError("connection lost"),
    )
    session.commit.side_effect = commit_error
    session.rollback.side_effect = RuntimeError("rollback failed")
    session.close.side_effect = RuntimeError("close failed")
    uow = SqlAlchemyUnitOfWork(lambda: session)

    with (
        caplog.at_level(logging.WARNING),
        pytest.raises(OperationalError, match="connection lost") as caught,
        uow,
    ):
        uow.commit()

    assert caught.value is commit_error
    session.rollback.assert_called_once_with()
    session.close.assert_called_once_with()
    assert uow._session is None
    assert caplog.text.count("original transaction exception preserved") == 2


def test_failed_second_commit_does_not_inherit_first_commit_success():
    """Each commit attempt establishes its own authoritative outcome."""
    session = MagicMock(spec=Session)
    second_commit_error = OperationalError(
        "COMMIT",
        {},
        RuntimeError("connection lost"),
    )
    session.commit.side_effect = [None, second_commit_error]
    uow = SqlAlchemyUnitOfWork(lambda: session)

    with uow:
        uow.commit()
        with pytest.raises(OperationalError, match="connection lost") as caught:
            uow.commit()

    assert caught.value is second_commit_error
    assert session.commit.call_count == 2
    session.rollback.assert_called_once_with()
    session.close.assert_called_once_with()


def test_normal_uncommitted_exit_rolls_back_closes_and_clears_session():
    """Leaving without commit performs normal rollback cleanup."""
    session = MagicMock(spec=Session)
    uow = SqlAlchemyUnitOfWork(lambda: session)

    with uow:
        pass

    session.rollback.assert_called_once_with()
    session.close.assert_called_once_with()
    assert uow._session is None


def test_exit_closes_and_clears_session_when_rollback_fails():
    """The first standalone cleanup error wins after all cleanup is attempted."""
    session = MagicMock(spec=Session)
    rollback_error = RuntimeError("rollback failed")
    session.rollback.side_effect = rollback_error
    session.close.side_effect = RuntimeError("close failed")
    uow = _entered_uow(session)

    with pytest.raises(RuntimeError) as caught:
        uow.__exit__(None, None, None)

    assert caught.value is rollback_error
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


def test_uow_can_be_reused_with_a_fresh_session_after_exit():
    """A completed context releases the active guard for a later session."""
    first_session = MagicMock(spec=Session)
    second_session = MagicMock(spec=Session)
    session_factory = MagicMock(side_effect=[first_session, second_session])
    uow = SqlAlchemyUnitOfWork(session_factory)

    with uow:
        uow.commit()
    with uow:
        uow.commit()

    assert session_factory.call_count == 2
    first_session.commit.assert_called_once_with()
    first_session.close.assert_called_once_with()
    second_session.commit.assert_called_once_with()
    second_session.close.assert_called_once_with()


def test_enter_rejects_reuse_while_session_is_active():
    """Nested entry cannot overwrite the session retained by an active UoW."""
    session = MagicMock(spec=Session)
    uow = _entered_uow(session)

    with pytest.raises(RuntimeError, match="already has an active session"):
        uow.__enter__()

    assert uow._session is session
    uow.__exit__(None, None, None)
