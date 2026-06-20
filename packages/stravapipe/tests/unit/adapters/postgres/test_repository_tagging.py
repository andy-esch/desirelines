"""Unit tests for SqlAlchemyActivityRepository.tag_activity_regions resilience.

The happy paths (specific-region match, earth fallback, no-route, idempotency)
are covered by integration tests against real PostGIS — which the coverage run
excludes. This unit test exercises the one branch integration can't easily
trigger: a spatial-tagging failure that rolls back the savepoint, logs a
warning, and degrades to the builtin 'earth' fallback (so the activity stays
committed and visible on the map's global view).
"""

import logging
from unittest.mock import MagicMock

from sqlalchemy.exc import SQLAlchemyError

from stravapipe.adapters.postgres._repository import SqlAlchemyActivityRepository


def test_tag_activity_regions_falls_back_to_earth_on_spatial_error(caplog):
    """A spatial-join failure → savepoint rollback → warning → 'earth' tag."""
    session = MagicMock()

    # begin_nested() is used as a context manager; __exit__ must return False so
    # the raised SQLAlchemyError propagates to the method's except branch (rather
    # than being suppressed by MagicMock's truthy default).
    savepoint = MagicMock()
    savepoint.__exit__.return_value = False
    session.begin_nested.return_value = savepoint

    earth_result = MagicMock()
    earth_result.fetchall.return_value = [(1,)]  # one 'earth' row inserted

    # Call sequence: DELETE existing tags, spatial INSERT (fails), earth INSERT.
    session.execute.side_effect = [
        MagicMock(),  # DELETE
        SQLAlchemyError("spatial boom"),  # specific-region INSERT (inside savepoint)
        earth_result,  # earth fallback INSERT
    ]

    repo = SqlAlchemyActivityRepository(session)

    with caplog.at_level(logging.WARNING):
        count = repo.tag_activity_regions(123)

    assert count == 1  # earth fallback applied, activity still tagged
    assert "falling back to 'earth'" in caplog.text
    assert session.execute.call_count == 3  # DELETE + spatial + earth
