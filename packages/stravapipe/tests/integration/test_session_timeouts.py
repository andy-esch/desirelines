"""Integration tests for the per-transaction server-side timeouts.

Proves the ``after_begin`` listener in ``_unit_of_work`` actually lands its
``SET LOCAL`` before the transaction's own SQL, against a real PostgreSQL. The
unit tests fire that event by hand and so cannot show the ordering.

Requires PostgreSQL with Flyway migrations applied; connection comes from
``--db-url`` or ``POSTGRES_TEST_CONNECTION_STRING`` (see conftest.py).
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.postgres import (
    PoolConfig,
    PoolStrategy,
    create_session_factory,
)

# Deliberately unusual so a passing assertion can only come from this config,
# never from a server default that happens to match.
_STATEMENT_TIMEOUT_MS = 17_000
_IDLE_IN_TXN_TIMEOUT_MS = 41_000


def _single_connection_config(
    *,
    statement_timeout_ms: int,
    idle_in_transaction_timeout_ms: int,
) -> PoolConfig:
    """Build a PoolConfig capped at one connection, no overflow.

    The leak test needs the second checkout to be guaranteed the same physical
    connection the first transaction ran on.
    """
    return PoolConfig(
        strategy=PoolStrategy.INTERNAL,
        pool_size=1,
        max_overflow=0,
        statement_timeout_ms=statement_timeout_ms,
        idle_in_transaction_timeout_ms=idle_in_transaction_timeout_ms,
    )


def _current_setting(session: Session, guc: str) -> str:
    return session.execute(
        text("SELECT current_setting(:guc)"), {"guc": guc}
    ).scalar_one()


def _connection_setting(engine: Engine, guc: str) -> str:
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT current_setting(:guc)"), {"guc": guc}
        ).scalar_one()


@pytest.fixture
def timeout_engine(db_url: str) -> Iterator[tuple[Engine, sessionmaker[Session]]]:
    """A real ``create_session_factory`` result with the timeouts configured.

    Not the ``db_session`` fixture: it binds its own Session, bypassing the
    factory whose listener is under test. Read-only, so skipping that fixture's
    rollback wrapper costs nothing.
    """
    engine, session_factory = create_session_factory(
        db_url,
        _single_connection_config(
            statement_timeout_ms=_STATEMENT_TIMEOUT_MS,
            idle_in_transaction_timeout_ms=_IDLE_IN_TXN_TIMEOUT_MS,
        ),
    )
    try:
        yield engine, session_factory
    finally:
        engine.dispose()


def test_timeouts_apply_inside_the_transaction(timeout_engine):
    """Both GUCs should be in force for the transaction's first statement."""
    _, session_factory = timeout_engine

    with session_factory() as session:
        assert _current_setting(session, "statement_timeout") == "17s"
        assert _current_setting(session, "idle_in_transaction_session_timeout") == "41s"


def test_savepoints_inherit_the_timeouts(timeout_engine):
    """Why the listener skips nested transactions: the savepoint already has them.

    The region-tagging path opens a savepoint per activity, so re-issuing the
    SET LOCAL there would be one wasted round trip each.
    """
    _, session_factory = timeout_engine

    with session_factory() as session, session.begin_nested():
        assert _current_setting(session, "statement_timeout") == "17s"


def test_timeouts_do_not_outlive_the_transaction(timeout_engine):
    """SET LOCAL, not SET: the setting must not stick to the connection.

    This is what makes the approach safe behind a transaction pooler, which
    hands the server connection to another client at commit. The pool is
    capped at one connection, so the check below is reading back the very
    connection the transaction ran on.
    """
    engine, session_factory = timeout_engine

    with session_factory() as session:
        assert _current_setting(session, "statement_timeout") == "17s"

    assert _connection_setting(engine, "statement_timeout") != "17s"


def test_disabled_timeouts_leave_the_server_default(db_url: str):
    """Both knobs at 0 is the escape hatch: no SET LOCAL is issued at all."""
    engine, session_factory = create_session_factory(
        db_url,
        _single_connection_config(
            statement_timeout_ms=0,
            idle_in_transaction_timeout_ms=0,
        ),
    )
    try:
        server_default = _connection_setting(engine, "statement_timeout")
        with session_factory() as session:
            assert _current_setting(session, "statement_timeout") == server_default
    finally:
        engine.dispose()
