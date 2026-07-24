"""Unit tests for SqlAlchemyActivityRepository.tag_activity_regions resilience.

The happy paths (specific-region match, earth fallback, no-route, idempotency)
are covered by integration tests against real PostGIS — which the coverage run
excludes. These unit tests exercise failure and readiness branches precisely.
"""

import logging
from unittest.mock import MagicMock

import pytest
from sqlalchemy.exc import SQLAlchemyError

from stravapipe.adapters.postgres._repository import SqlAlchemyActivityRepository


def _session_with_savepoints() -> MagicMock:
    session = MagicMock()
    savepoint = MagicMock()
    savepoint.__exit__.return_value = False
    session.begin_nested.return_value = savepoint
    return session


def _result(*rows: tuple[object, ...]) -> MagicMock:
    result = MagicMock()
    result.fetchall.return_value = list(rows)
    return result


def _readiness(*, specific_regions: int = 100, has_earth: bool = True) -> MagicMock:
    result = MagicMock()
    result.fetchone.return_value = (specific_regions, has_earth)
    return result


def _has_route(value: bool = True) -> MagicMock:
    result = MagicMock()
    result.scalar_one.return_value = value
    return result


def test_tag_activity_regions_preserves_existing_tags_on_spatial_error(caplog):
    """A spatial failure rolls back the preceding delete and skips fallback."""
    session = _session_with_savepoints()
    session.execute.side_effect = [
        MagicMock(),  # DELETE
        SQLAlchemyError("spatial boom"),  # specific-region INSERT (inside savepoint)
    ]
    repo = SqlAlchemyActivityRepository(session)

    with caplog.at_level(logging.WARNING):
        count = repo.tag_activity_regions(123)

    assert count == 0
    assert "Region spatial tagging failed" in caplog.text
    assert "SQLAlchemyError" in caplog.text
    assert "existing region tags preserved" in caplog.text
    assert session.execute.call_count == 2


def test_tag_activity_regions_logs_unloaded_table_after_earth_fallback(caplog):
    session = _session_with_savepoints()
    session.execute.side_effect = [
        MagicMock(),  # DELETE
        _result(),  # no specific matches
        _has_route(),
        _result((1,)),  # earth fallback
        _readiness(specific_regions=0),
    ]
    repo = SqlAlchemyActivityRepository(session)

    with caplog.at_level(logging.ERROR):
        count = repo.tag_activity_regions(123)

    assert count == 1
    assert "Regions table appears unloaded or incomplete" in caplog.text
    assert "only 0 non-global regions found" in caplog.text


def test_tag_activity_regions_does_not_log_systemic_error_for_off_grid_route(caplog):
    session = _session_with_savepoints()
    session.execute.side_effect = [
        MagicMock(),  # DELETE
        _result(),  # no specific matches
        _has_route(),
        _result((1,)),  # earth fallback
        _readiness(specific_regions=100),
    ]
    repo = SqlAlchemyActivityRepository(session)

    with caplog.at_level(logging.ERROR):
        count = repo.tag_activity_regions(123)

    assert count == 1
    assert "Regions table appears unloaded or incomplete" not in caplog.text


def test_tag_activity_regions_skips_readiness_check_without_route(caplog):
    """An absent route clears stale tags without paying for the dataset count."""
    session = _session_with_savepoints()
    session.execute.side_effect = [
        MagicMock(),  # DELETE
        _result(),  # no specific matches
        _has_route(False),
    ]
    repo = SqlAlchemyActivityRepository(session)

    with caplog.at_level(logging.ERROR):
        count = repo.tag_activity_regions(123)

    assert count == 0
    assert session.execute.call_count == 3
    assert "Regions table appears unloaded or incomplete" not in caplog.text


@pytest.mark.parametrize(
    ("calls", "message"),
    [
        (
            [SQLAlchemyError("reset boom")],
            "Region-tag reset failed",
        ),
        (
            [
                MagicMock(),
                _result(),
                _has_route(),
                SQLAlchemyError("earth boom"),
            ],
            "Earth region fallback failed",
        ),
    ],
)
def test_tag_activity_regions_degrades_when_atomic_retag_step_fails(
    calls: list[object],
    message: str,
    caplog,
):
    """Reset/fallback failures roll back the savepoint and never escape."""
    session = _session_with_savepoints()
    session.execute.side_effect = calls
    repo = SqlAlchemyActivityRepository(session)

    with caplog.at_level(logging.WARNING):
        count = repo.tag_activity_regions(123)

    assert count == 0
    assert message in caplog.text
    assert "existing region tags preserved" in caplog.text
