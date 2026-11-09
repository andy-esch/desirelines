"""Real SQL ownership isolation, compatibility gates and absent-mapping races."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from stravapipe.adapters.postgres import SqlAlchemyActivityRepository
from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete
from stravapipe.domain.ownership import ActivityOwner, ActivityOwnershipError
from stravapipe.ports.out.postgres import DeleteResult, InsertResult
from tests.integration.helpers import migrated_database, wait_until_waiting_on_a_lock

OWNER = ActivityOwner("opaque-owner", "222")
ID = 18_000_000_111
ROUTE = '{"type":"LineString","coordinates":[[0,0],[1,1]]}'


@pytest.fixture(scope="module")
def engine(db_url):
    with migrated_database(db_url, 18) as isolated:
        yield isolated


def activity(subject=222):
    return StandardActivity(
        id=ID,
        athlete=MetaAthlete(id=subject, resource_state=1),
        name="Owned activity",
        type="Run",
        sport_type="Run",
        start_date_local=datetime(2026, 11, 1, tzinfo=UTC),
        distance=1000,
        moving_time=100,
        elapsed_time=100,
        total_elevation_gain=0,
    )


def invoke(repo, operation, subject=222):
    operations = {
        "insert": lambda: repo.insert(activity(subject), 200),
        "upsert": lambda: repo.upsert(activity(subject), 200),
        "backfill": lambda: repo.upsert_backfill(activity(subject), 200),
        "delete": lambda: repo.delete(ID, 200),
        "metadata": lambda: repo.update_metadata(ID, {"title": "changed"}, 200),
        "exists": lambda: repo.exists(ID),
        "skip": lambda: repo.get_existing_ids([ID]),
        "route": lambda: repo.insert_route(ID, ROUTE),
        "regions": lambda: repo.tag_activity_regions(ID),
        "clear_regions": lambda: repo.clear_activity_regions(ID),
    }
    return operations[operation]()


@pytest.mark.parametrize(
    "operation",
    [
        "insert",
        "upsert",
        "backfill",
        "delete",
        "metadata",
        "exists",
        "skip",
        "route",
        "regions",
        "clear_regions",
    ],
)
@pytest.mark.parametrize(
    "intruder",
    [
        ActivityOwner("222", "333"),
        ActivityOwner("other-uid", "222"),
        ActivityOwner("opaque-owner", "333"),
    ],
)
def test_every_individual_operation_rejects_conflicting_mapping(
    db_session, operation, intruder
):
    own = SqlAlchemyActivityRepository(db_session, owner=OWNER)
    assert own.insert(activity(), 100) is InsertResult.INSERTED
    assert own.insert_route(ID, ROUTE)
    before = db_session.execute(text("SELECT * FROM desirelines.activities")).all()
    with pytest.raises(ActivityOwnershipError):
        invoke(
            SqlAlchemyActivityRepository(db_session, owner=intruder),
            operation,
            int(intruder.subject),
        )
    assert (
        db_session.execute(text("SELECT * FROM desirelines.activities")).all() == before
    )
    assert (
        db_session.execute(
            text("SELECT count(*) FROM desirelines.activity_routes")
        ).scalar_one()
        == 1
    )
    assert (
        db_session.execute(
            text("SELECT count(*) FROM desirelines.activity_deletion_fences")
        ).scalar_one()
        == 0
    )


@pytest.mark.parametrize(
    "operation",
    [
        "insert",
        "upsert",
        "backfill",
        "delete",
        "metadata",
        "exists",
        "skip",
        "route",
        "regions",
        "clear_regions",
    ],
)
def test_unbound_repository_fails_closed(db_session, operation):
    with pytest.raises(ActivityOwnershipError):
        invoke(SqlAlchemyActivityRepository(db_session), operation)


@pytest.mark.parametrize(
    ("uid", "subject", "blocks"),
    [
        (OWNER.uid, OWNER.subject, True),
        ("222", OWNER.subject, False),
        (OWNER.uid, "333", False),
    ],
)
def test_fences_match_exact_uid_and_provider_subject(db_session, uid, subject, blocks):
    db_session.execute(
        text("""INSERT INTO desirelines.activity_deletion_fences
        (source, external_id, user_id, external_owner_id, deletion_event_time)
        VALUES ('strava', :id, :uid, :subject, 300)"""),
        {"id": str(ID), "uid": uid, "subject": subject},
    )
    result = SqlAlchemyActivityRepository(db_session, owner=OWNER).insert(
        activity(), 200
    )
    assert result is (
        InsertResult.RESURRECTION_BLOCKED if blocks else InsertResult.INSERTED
    )


def test_historical_global_fence_still_blocks_opaque_owner(db_session):
    db_session.execute(
        text("""INSERT INTO desirelines.deleted_activities
        (source, external_id, deletion_event_time) VALUES ('strava', :id, 300)"""),
        {"id": str(ID)},
    )
    assert (
        SqlAlchemyActivityRepository(db_session, owner=OWNER).insert(activity(), 200)
        is InsertResult.RESURRECTION_BLOCKED
    )


@pytest.mark.parametrize("full_account", [True, False])
def test_pre_activation_delete_rolls_back_without_losing_activities(
    db_session, full_account
):
    own = SqlAlchemyActivityRepository(db_session, owner=OWNER)
    own.insert(activity(), 100)
    with (  # noqa: PT012 -- verify rollback of a complete transaction
        pytest.raises(ProgrammingError, match="permission denied"),
        db_session.begin_nested(),
    ):
        db_session.execute(text("SET LOCAL ROLE desirelines_dml_grp"))
        if full_account:
            SqlAlchemyActivityRepository(db_session).delete_by_user(OWNER.uid)
        else:
            own.delete(ID, 200)
    assert own.exists(ID)


def test_full_account_cleanup_purges_only_its_uid_markers(db_session):
    own = SqlAlchemyActivityRepository(db_session, owner=OWNER)
    own.insert(activity(), 100)
    own.delete(ID, 200)
    db_session.execute(
        text("""INSERT INTO desirelines.activity_deletion_fences
        (source, external_id, user_id, external_owner_id, deletion_event_time)
        VALUES ('strava', :id, '222', '333', 300)"""),
        {"id": str(ID)},
    )
    assert own.insert(activity(), 400) is InsertResult.INSERTED
    assert SqlAlchemyActivityRepository(db_session).delete_by_user(OWNER.uid) == 1
    assert not own.exists(ID)
    assert db_session.execute(
        text("SELECT user_id FROM desirelines.activity_deletion_fences")
    ).scalars().all() == ["222"]


@pytest.mark.parametrize("same_owner", [True, False])
def test_absent_mapping_delete_serializes_before_first_claim(engine, same_owner):
    second_owner = OWNER if same_owner else ActivityOwner("222", "333")
    with Session(engine) as first, Session(engine) as second:
        try:
            assert (
                SqlAlchemyActivityRepository(first, owner=OWNER).delete(ID, 300)
                is DeleteResult.NOT_FOUND
            )
            pid = second.execute(text("SELECT pg_backend_pid()")).scalar_one()
            second.execute(text("SET LOCAL lock_timeout = '10s'"))
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(
                    SqlAlchemyActivityRepository(second, owner=second_owner).insert,
                    activity(int(second_owner.subject)),
                    200,
                )
                try:
                    wait_until_waiting_on_a_lock(engine, pid)
                finally:
                    first.commit()
                assert future.result(timeout=15) is (
                    InsertResult.RESURRECTION_BLOCKED
                    if same_owner
                    else InsertResult.INSERTED
                )
            second.commit()
        finally:
            first.rollback()
            second.rollback()
            with engine.begin() as cleanup:
                cleanup.execute(text("DELETE FROM desirelines.activities"))
                cleanup.execute(
                    text("DELETE FROM desirelines.activity_deletion_fences")
                )


@pytest.mark.parametrize("operation", ["insert", "upsert", "backfill", "delete"])
def test_concurrent_claim_cannot_reuse_another_owners_mapping(engine, operation):
    with Session(engine) as first, Session(engine) as second:
        try:
            assert (
                SqlAlchemyActivityRepository(first, owner=OWNER).insert(activity(), 100)
                is InsertResult.INSERTED
            )
            pid = second.execute(text("SELECT pg_backend_pid()")).scalar_one()
            second.execute(text("SET LOCAL lock_timeout = '10s'"))
            intruder = SqlAlchemyActivityRepository(
                second, owner=ActivityOwner("222", "333")
            )
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(invoke, intruder, operation, 333)
                try:
                    wait_until_waiting_on_a_lock(engine, pid)
                finally:
                    first.commit()
                with pytest.raises(ActivityOwnershipError):
                    future.result(timeout=15)
            second.rollback()
            assert first.execute(
                text("SELECT user_id FROM desirelines.activities")
            ).scalars().all() == [OWNER.uid]
            assert (
                first.execute(
                    text("SELECT count(*) FROM desirelines.activity_deletion_fences")
                ).scalar_one()
                == 0
            )
        finally:
            first.rollback()
            second.rollback()
            with engine.begin() as cleanup:
                cleanup.execute(text("DELETE FROM desirelines.activities"))
                cleanup.execute(
                    text("DELETE FROM desirelines.activity_deletion_fences")
                )
