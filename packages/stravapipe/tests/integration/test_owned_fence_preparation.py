"""Run V0018 over an isolated V0017 database, including real role privileges."""

from datetime import UTC, datetime
import json
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError

from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete
from tests.integration.helpers import (
    database_resource,
    insert_mapped_activity,
    migrated_database,
    upsert_mapped_tombstone,
)

FENCE = "desirelines.activity_deletion_fences"
MIGRATION = "migrations/V0018__prepare_owned_activity_deletion_fences.sql"
INSERT = text("""
    INSERT INTO desirelines.activity_deletion_fences
        (source, external_id, user_id, external_owner_id, deletion_event_time)
    VALUES ('strava', '123', :uid, :subject, 200)
""")


@pytest.fixture(scope="module")
def engine(db_url):
    with migrated_database(db_url, 17) as historical:
        yield historical


def prepare(session):
    session.execute(text(database_resource(MIGRATION).read_text()))


def activity():
    return StandardActivity(
        id=18000000001,
        athlete=MetaAthlete(id=222, resource_state=1),
        name="Fence compatibility",
        type="Run",
        sport_type="Run",
        start_date_local=datetime(2026, 11, 1, tzinfo=UTC),
        distance=1000,
        moving_time=100,
        elapsed_time=100,
        total_elevation_gain=0,
    )


def test_migration_preserves_legacy_rows_metadata_and_protocol_zero_writer(db_session):
    insert_mapped_activity(db_session, activity().id, 100)
    live_before = db_session.execute(text("SELECT * FROM desirelines.activities")).all()
    links_before = db_session.execute(
        text("SELECT * FROM desirelines.activity_external_ids")
    ).all()
    db_session.execute(
        text("""
        INSERT INTO desirelines.deleted_activities
            (source, external_id, deletion_event_time, deleted_at, deletion_correlation_id)
        VALUES ('strava', '999', 200, '2026-10-01 12:34:56', 'legacy-correlation')
    """)
    )
    legacy_before = db_session.execute(
        text("SELECT * FROM desirelines.deleted_activities")
    ).all()

    prepare(db_session)

    assert (
        db_session.execute(text("SELECT * FROM desirelines.activities")).all()
        == live_before
    )
    assert (
        db_session.execute(
            text("SELECT * FROM desirelines.activity_external_ids")
        ).all()
        == links_before
    )
    assert (
        db_session.execute(text("SELECT * FROM desirelines.deleted_activities")).all()
        == legacy_before
    )
    assert db_session.execute(text(f"SELECT count(*) FROM {FENCE}")).scalar_one() == 0
    db_session.execute(text("SET LOCAL ROLE desirelines_dml_grp"))
    upsert_mapped_tombstone(db_session, activity().id, 200, "after-preparation")
    db_session.execute(text("DELETE FROM desirelines.activities"))
    insert_mapped_activity(db_session, activity().id, 150)
    assert (
        db_session.execute(
            text("SELECT count(*) FROM desirelines.activities")
        ).scalar_one()
        == 0
    )
    insert_mapped_activity(db_session, activity().id, 201)
    assert (
        db_session.execute(
            text("SELECT count(*) FROM desirelines.activities")
        ).scalar_one()
        == 1
    )


@pytest.mark.parametrize("operation", ["INSERT", "UPDATE", "DELETE"])
def test_preparation_does_not_implicitly_enable_default_dml_grants(
    db_session, operation
):
    prepare(db_session)
    assert not db_session.execute(
        text("SELECT has_table_privilege('desirelines_dml_grp', :table, :operation)"),
        {"table": FENCE, "operation": operation},
    ).scalar_one()
    statements = {
        "INSERT": INSERT,
        "UPDATE": text(f"UPDATE {FENCE} SET deletion_event_time = 201"),
        "DELETE": text(f"DELETE FROM {FENCE}"),
    }
    db_session.execute(text("SET LOCAL ROLE desirelines_dml_grp"))
    with (
        pytest.raises(ProgrammingError, match="permission denied"),
        db_session.begin_nested(),
    ):
        db_session.execute(
            statements[operation], {"uid": "app-alpha", "subject": "222"}
        )


@pytest.mark.parametrize("role", ["desirelines_dml_grp", "desirelines_ro_grp"])
def test_existing_runtime_roles_can_read_prepared_table(db_session, role):
    prepare(db_session)
    db_session.execute(text(f"SET LOCAL ROLE {role}"))
    assert db_session.execute(text(f"SELECT count(*) FROM {FENCE}")).scalar_one() == 0


def test_owned_keys_are_independent_without_activity_or_mapping_fk(db_session):
    prepare(db_session)
    # Migration owner can exercise the future table shape; runtime cannot yet.
    owners = [("app-alpha", "222"), ("222", "333"), ("app-alpha", "333")]
    for uid, subject in owners:
        db_session.execute(INSERT, {"uid": uid, "subject": subject})
    actual = db_session.execute(
        text(
            f"SELECT user_id, external_owner_id FROM {FENCE} ORDER BY user_id, external_owner_id"
        )
    ).all()
    assert sorted(actual) == sorted(owners)
    assert (
        db_session.execute(
            text("SELECT count(*) FROM desirelines.activity_external_ids")
        ).scalar_one()
        == 0
    )
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.execute(INSERT, {"uid": "app-alpha", "subject": "222"})


@pytest.mark.parametrize(
    ("uid", "subject"),
    [
        ("", "222"),
        ("x" * 129, "222"),
        ("app-alpha", ""),
        (None, "222"),
        ("app-alpha", None),
    ],
)
def test_prepared_fences_require_explicit_owner_tuple(db_session, uid, subject):
    prepare(db_session)
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.execute(INSERT, {"uid": uid, "subject": subject})


def test_preparation_also_removes_inherited_public_write_grants(db_session):
    db_session.execute(text("SET LOCAL ROLE desirelines_ddl_grp"))
    db_session.execute(
        text(
            "ALTER DEFAULT PRIVILEGES FOR ROLE desirelines_ddl_grp IN SCHEMA desirelines GRANT ALL ON TABLES TO PUBLIC"
        )
    )
    db_session.execute(text("RESET ROLE"))
    prepare(db_session)
    assert not db_session.execute(
        text("SELECT has_table_privilege('desirelines_dml_grp', :table, 'INSERT')"),
        {"table": FENCE},
    ).scalar_one()


def test_latest_schema_cannot_enable_fences_without_release_requirement(db_url):
    # Also rerun the real callback: a future blanket grant there must not bypass
    # the activation declaration when Flyway runs again on an existing schema.
    candidates = [
        parent / "scripts/ci/identity-rollout.json"
        for parent in Path(__file__).resolve().parents
    ]
    candidates.append(Path("ci/identity-rollout.json"))
    contract = json.loads(
        next(path for path in candidates if path.is_file()).read_text()
    )
    with migrated_database(db_url, 9999) as latest, latest.begin() as connection:
        connection.execute(
            text(database_resource("callbacks/beforeMigrate.sql").read_text())
        )
        permissions = [
            connection.execute(
                text(
                    "SELECT has_table_privilege('desirelines_dml_grp', :table, :operation)"
                ),
                {"table": FENCE, "operation": operation},
            ).scalar_one()
            for operation in ("INSERT", "UPDATE", "DELETE")
        ]
        assert (
            not any(permissions) or contract.get("required_writer_protocol", 0) == 1
        ), (
            "Fence DML activation must require writer protocol 1 in the release declaration"
        )
