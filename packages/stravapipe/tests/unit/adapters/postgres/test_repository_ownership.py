"""Owner boundary failures must happen before mutation; real races use PostGIS."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from stravapipe.adapters.postgres import SqlAlchemyActivityRepository
from stravapipe.domain.ownership import ActivityOwner, ActivityOwnershipError

OWNER = ActivityOwner("opaque", "222")


@pytest.mark.parametrize("external_id", [0, -1, True, 2**63])
def test_invalid_id_does_not_reach_sql(external_id):
    session = MagicMock()
    with pytest.raises(ActivityOwnershipError):
        SqlAlchemyActivityRepository(session, owner=OWNER).exists(external_id)
    session.execute.assert_not_called()


def test_missing_owner_does_not_reach_sql():
    session = MagicMock()
    with pytest.raises(ActivityOwnershipError):
        SqlAlchemyActivityRepository(session).delete(123, 200)
    session.execute.assert_not_called()


@pytest.mark.parametrize(
    ("uid", "subject"), [(None, "222"), ("222", "222"), ("opaque", "333")]
)
def test_orphan_or_conflicting_mapping_fails_closed(uid, subject):
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = SimpleNamespace(
        user_id=uid, external_owner_id=subject
    )
    with pytest.raises(ActivityOwnershipError):
        SqlAlchemyActivityRepository(session, owner=OWNER).exists(123)
    assert session.execute.call_count == 2  # lock and owner check, no mutation


def test_mapping_lookup_carries_separate_namespaces():
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = SimpleNamespace(
        user_id=OWNER.uid, external_owner_id=OWNER.subject
    )
    assert SqlAlchemyActivityRepository(session, owner=OWNER).exists(123)
    params = session.execute.call_args.args[1]
    assert params == {
        "source": "strava",
        "external_id": "123",
        "user_id": "opaque",
        "external_owner_id": "222",
    }
