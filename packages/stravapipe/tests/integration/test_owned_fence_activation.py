"""V0019 grants runtime DML without changing stored activity/deletion history."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from stravapipe.adapters.postgres import SqlAlchemyActivityRepository
from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete
from stravapipe.domain.ownership import ActivityOwner
from stravapipe.ports.out.postgres import (
    BackfillUpsertResult,
    DeleteResult,
    InsertResult,
)
from tests.integration.helpers import database_resource, migrated_database

OWNER = ActivityOwner("opaque-owner", "222")
EXTERNAL_ID = 18_000_000_111
TABLE = "desirelines.activity_deletion_fences"


@pytest.fixture(scope="module")
def engine(db_url):
    with migrated_database(db_url, 18) as historical:
        yield historical


def activate(session):
    session.execute(
        text(
            database_resource(
                "migrations/V0019__activate_owned_activity_deletion_fences.sql"
            ).read_text()
        )
    )


def activity():
    return StandardActivity(
        id=EXTERNAL_ID,
        athlete=MetaAthlete(id=222, resource_state=1),
        name="Activation",
        type="Run",
        sport_type="Run",
        start_date_local=datetime(2026, 11, 1, tzinfo=UTC),
        distance=1000,
        moving_time=100,
        elapsed_time=100,
        total_elevation_gain=0,
    )


def seed_history(session):
    SqlAlchemyActivityRepository(session, owner=OWNER).insert(activity(), 100)
    session.execute(
        text("""INSERT INTO desirelines.deleted_activities
        (source, external_id, deletion_event_time, deleted_at, deletion_correlation_id)
        VALUES ('strava', '999', 200, '2026-11-01 12:34:56', 'historical')""")
    )
    session.execute(
        text("""INSERT INTO desirelines.activity_deletion_fences
        (source, external_id, user_id, external_owner_id, deletion_event_time,
         deleted_at, deletion_correlation_id)
        VALUES ('strava', '777', 'opaque-owner', '222', 200, '2026-11-02 12:34:56', 'owned'),
               ('strava', '777', '222', '333', 200, '2026-11-02 12:34:56', 'other')""")
    )


def test_activation_preserves_data_and_metadata(db_session):
    seed_history(db_session)
    tables = (
        "activities",
        "activity_external_ids",
        "deleted_activities",
        "activity_deletion_fences",
    )
    before = {
        name: db_session.execute(
            text(f"SELECT * FROM desirelines.{name} ORDER BY 1, 2, 3")
        ).all()
        for name in tables
    }
    activate(db_session)
    # The real callback must not remove the grant on a subsequent migration run.
    db_session.execute(
        text(database_resource("callbacks/beforeMigrate.sql").read_text())
    )
    after = {
        name: db_session.execute(
            text(f"SELECT * FROM desirelines.{name} ORDER BY 1, 2, 3")
        ).all()
        for name in tables
    }
    assert after == before
    for operation in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        assert db_session.execute(
            text(
                "SELECT has_table_privilege('desirelines_dml_grp', :table, :operation)"
            ),
            {"table": TABLE, "operation": operation},
        ).scalar_one()
    assert not db_session.execute(
        text("SELECT has_table_privilege('desirelines_dml_grp', :table, 'TRUNCATE')"),
        {"table": TABLE},
    ).scalar_one()


@pytest.mark.parametrize("operation", ["INSERT", "UPDATE", "DELETE"])
def test_activation_keeps_read_only_role_read_only(db_session, operation):
    activate(db_session)
    assert not db_session.execute(
        text("SELECT has_table_privilege('desirelines_ro_grp', :table, :operation)"),
        {"table": TABLE, "operation": operation},
    ).scalar_one()
    db_session.execute(text("SET LOCAL ROLE desirelines_ro_grp"))
    assert db_session.execute(text(f"SELECT count(*) FROM {TABLE}")).scalar_one() == 0
    sql = {
        "INSERT": "INSERT INTO desirelines.activity_deletion_fences (source, external_id, user_id, external_owner_id, deletion_event_time) VALUES ('strava', '123', 'opaque-owner', '222', 200)",
        "UPDATE": "UPDATE desirelines.activity_deletion_fences SET deletion_event_time = 300",
        "DELETE": "DELETE FROM desirelines.activity_deletion_fences",
    }[operation]
    with (
        pytest.raises(ProgrammingError, match="permission denied"),
        db_session.begin_nested(),
    ):
        db_session.execute(text(sql))


def test_writer_role_can_delete_fence_and_purge_only_its_uid(db_session):
    seed_history(db_session)
    activate(db_session)
    db_session.execute(text("SET LOCAL ROLE desirelines_dml_grp"))
    repo = SqlAlchemyActivityRepository(db_session, owner=OWNER)
    assert repo.delete(EXTERNAL_ID, 300, "current") is DeleteResult.DELETED
    assert repo.delete(EXTERNAL_ID, 200, "older") is DeleteResult.NOT_FOUND
    marker = db_session.execute(
        text(
            f"SELECT deletion_event_time, deletion_correlation_id FROM {TABLE} WHERE external_id = :id"
        ),
        {"id": str(EXTERNAL_ID)},
    ).one()
    assert tuple(marker) == (300, "current")
    assert repo.insert(activity(), 300) is InsertResult.RESURRECTION_BLOCKED
    assert repo.upsert_backfill(activity(), 299) is BackfillUpsertResult.SKIPPED
    assert repo.insert(activity(), 400) is InsertResult.INSERTED
    assert SqlAlchemyActivityRepository(db_session).delete_by_user(OWNER.uid) == 1
    assert not repo.exists(EXTERNAL_ID)
    assert db_session.execute(
        text(f"SELECT user_id, external_owner_id FROM {TABLE}")
    ).all() == [("222", "333")]
    assert (
        db_session.execute(
            text("SELECT count(*) FROM desirelines.deleted_activities")
        ).scalar_one()
        == 1
    )
