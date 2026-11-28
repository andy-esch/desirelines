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


def test_get_existing_ids_locks_and_checks_each_id_before_the_query():
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = SimpleNamespace(
        user_id=OWNER.uid, external_owner_id=OWNER.subject
    )
    session.execute.return_value.fetchall.return_value = [
        SimpleNamespace(external_id="2")
    ]

    existing = SqlAlchemyActivityRepository(session, owner=OWNER).get_existing_ids(
        [3, 1, 2, 1]
    )

    assert existing == {2}
    calls = session.execute.call_args_list
    # One advisory lock and one ownership lookup per unique ID, in ID order,
    # then the single existence query.
    assert len(calls) == 2 * 3 + 1
    lock_keys = [c.args[1]["key"] for c in calls if "key" in c.args[1]]
    assert lock_keys == ["strava:1", "strava:2", "strava:3"]
    assert calls[-1].args[1] == {
        "source": "strava",
        "user_id": "opaque",
        "external_owner_id": "222",
        "external_ids": ["3", "1", "2", "1"],
    }


def test_get_existing_ids_fails_closed_on_another_owners_mapping():
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = SimpleNamespace(
        user_id="opaque", external_owner_id="333"
    )
    with pytest.raises(ActivityOwnershipError):
        SqlAlchemyActivityRepository(session, owner=OWNER).get_existing_ids([123])
    assert session.execute.call_count == 2  # lock and owner check, no query


def test_get_existing_ids_without_owner_does_not_reach_sql():
    session = MagicMock()
    with pytest.raises(ActivityOwnershipError):
        SqlAlchemyActivityRepository(session).get_existing_ids([123])
    session.execute.assert_not_called()


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
