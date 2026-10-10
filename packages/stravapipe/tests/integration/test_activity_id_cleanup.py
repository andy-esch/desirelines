"""Compatibility stage of activity-ID cleanup (V0014).

The migration must accept the deployed writer's tombstone SQL before the new
image rolls out. The new writer must also work after the eventual final DDL.
Schema changes below are transactional and rolled back by db_session.
"""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError

from stravapipe.adapters.postgres import SqlAlchemyActivityRepository
from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete
from stravapipe.ports.out.postgres import (
    BackfillUpsertResult,
    DeleteResult,
    InsertResult,
)
from tests.integration.helpers import activity_id_for, upsert_legacy_tombstone

_EXTERNAL_ID = 18_000_000_001


def _activity() -> StandardActivity:
    return StandardActivity(
        id=_EXTERNAL_ID,
        athlete=MetaAthlete(id=999, resource_state=1),
        name="Cleanup compatibility",
        type="Run",
        sport_type="Run",
        start_date_local=datetime(2026, 10, 10, 8, tzinfo=UTC),
        distance=1000,
        moving_time=100,
        elapsed_time=100,
        total_elevation_gain=0,
    )


class TestTombstoneCompatibility:
    @pytest.mark.parametrize("first_writer", ["legacy", "current"])
    def test_old_and_new_deletes_share_one_tombstone_and_keep_the_newest_metadata(
        self, db_session, first_writer
    ):
        db_session.execute(text("SET LOCAL ROLE desirelines_dml_grp"))
        repo = SqlAlchemyActivityRepository(db_session)
        for event_time, writer in (
            (200, first_writer),
            (100, "current" if first_writer == "legacy" else "legacy"),
        ):
            if writer == "legacy":
                upsert_legacy_tombstone(db_session, _EXTERNAL_ID, event_time)
            else:
                assert (
                    repo.delete(_EXTERNAL_ID, event_time, f"current-{event_time}")
                    is DeleteResult.NOT_FOUND
                )

        rows = db_session.execute(
            text("""
                SELECT id, source, external_id, deletion_event_time,
                       deleted_at, deletion_correlation_id
                FROM desirelines.deleted_activities
                WHERE source = 'strava' AND external_id = :external_id
            """),
            {"external_id": str(_EXTERNAL_ID)},
        ).all()
        assert len(rows) == 1
        row = rows[0]
        assert row.id == _EXTERNAL_ID
        assert row.deletion_event_time == 200
        assert row.deletion_correlation_id == f"{first_writer}-200"
        if first_writer == "legacy":
            assert row.deleted_at.replace(tzinfo=UTC) == datetime(
                2026, 10, 10, tzinfo=UTC
            )
        assert repo.insert(_activity(), 150) is InsertResult.RESURRECTION_BLOCKED

        # A later legacy deletion still advances a tombstone a new writer wrote.
        upsert_legacy_tombstone(db_session, _EXTERNAL_ID, 300)
        assert repo.insert(_activity(), 250) is InsertResult.RESURRECTION_BLOCKED
        assert repo.insert(_activity(), 301) is InsertResult.INSERTED

    def test_inconsistent_legacy_and_external_ids_are_rejected(self, db_session):
        with pytest.raises(IntegrityError, match="legacy_id_matches_external_id"):
            db_session.execute(
                text("""
                    INSERT INTO desirelines.deleted_activities
                        (id, source, external_id, deletion_event_time)
                    VALUES (:id, 'strava', 'different', 100)
                """),
                {"id": _EXTERNAL_ID},
            )

    def test_migration_preserves_a_legacy_tombstone(self, db_session):
        # Restore just the V0013 tombstone shape, then execute the real migration.
        # This runs on an otherwise fully migrated database and rolls back DDL.
        db_session.execute(
            text("""
            DROP TRIGGER bridge_legacy_tombstone_id ON desirelines.deleted_activities;
            DROP FUNCTION desirelines.bridge_legacy_tombstone_id();
            ALTER TABLE desirelines.deleted_activities DROP COLUMN external_id;
            ALTER TABLE desirelines.deleted_activities
                ADD COLUMN external_id TEXT GENERATED ALWAYS AS (id::text) STORED;
            CREATE UNIQUE INDEX deleted_activities_source_external_id_key
                ON desirelines.deleted_activities (source, external_id);
        """)
        )
        upsert_legacy_tombstone(db_session, _EXTERNAL_ID, 200)
        before = (
            db_session.execute(
                text("SELECT * FROM desirelines.deleted_activities WHERE id = :id"),
                {"id": _EXTERNAL_ID},
            )
            .one()
            ._mapping
        )

        # Resource roots differ between a normal checkout and Pants' sandbox.
        relative = (
            "schemas/database/migrations/V0014__activity_id_cleanup_compatibility.sql"
        )
        migration = next(
            parent / relative
            for parent in Path(__file__).resolve().parents
            if (parent / relative).is_file()
        )
        db_session.execute(text(migration.read_text()))

        after = (
            db_session.execute(
                text("SELECT * FROM desirelines.deleted_activities WHERE id = :id"),
                {"id": _EXTERNAL_ID},
            )
            .one()
            ._mapping
        )
        assert dict(after) == dict(before)
        assert (
            SqlAlchemyActivityRepository(db_session).delete(_EXTERNAL_ID, 300)
            is DeleteResult.NOT_FOUND
        )


class TestWriterWithFinalIdentitySchema:
    @pytest.fixture(autouse=True)
    def final_schema(self, db_session):
        # Exercise the next release's DDL without shipping it before writer
        # rollout. No fixture inserts bypass the production repository here.
        db_session.execute(
            text("""
            ALTER TABLE desirelines.activities ALTER COLUMN id SET GENERATED ALWAYS;
            DROP TRIGGER bridge_legacy_tombstone_id ON desirelines.deleted_activities;
            DROP FUNCTION desirelines.bridge_legacy_tombstone_id();
            ALTER TABLE desirelines.deleted_activities DROP COLUMN id;
            ALTER TABLE desirelines.deleted_activities
                ADD PRIMARY KEY USING INDEX deleted_activities_source_external_id_key;
        """)
        )

    @pytest.mark.parametrize("write", ["insert", "upsert", "backfill"])
    def test_writes_reuse_the_allocated_id_and_deletes_keep_the_external_key(
        self, db_session, write
    ):
        db_session.execute(text("SET LOCAL ROLE desirelines_dml_grp"))
        repo = SqlAlchemyActivityRepository(db_session)

        def write_activity(event_time: int) -> object:
            if write == "insert":
                return repo.insert(_activity(), event_time)
            if write == "upsert":
                return repo.upsert(_activity(), event_time)
            return repo.upsert_backfill(_activity(), event_time)

        expected = {
            "insert": InsertResult.INSERTED,
            "upsert": True,
            "backfill": BackfillUpsertResult.APPLIED,
        }[write]
        assert write_activity(100) == expected
        activity_id = db_session.execute(
            text("""
                SELECT activity_id FROM desirelines.activity_external_ids
                WHERE source = 'strava' AND external_id = :external_id
            """),
            {"external_id": str(_EXTERNAL_ID)},
        ).scalar_one()
        assert activity_id != _EXTERNAL_ID
        assert (
            write_activity(101)
            == {
                "insert": InsertResult.ALREADY_EXISTS,
                "upsert": True,
                "backfill": BackfillUpsertResult.APPLIED,
            }[write]
        )
        assert (
            db_session.execute(
                text("SELECT id FROM desirelines.activities WHERE id = :id"),
                {"id": activity_id},
            ).scalar_one()
            == activity_id
        )
        assert activity_id_for(db_session, _EXTERNAL_ID) == activity_id
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))

        assert repo.delete(_EXTERNAL_ID, 200) is DeleteResult.DELETED
        assert (
            write_activity(150)
            == {
                "insert": InsertResult.RESURRECTION_BLOCKED,
                "upsert": False,
                "backfill": BackfillUpsertResult.SKIPPED,
            }[write]
        )
        assert write_activity(201) == expected
        recreated_id = db_session.execute(
            text("""
                SELECT activity_id FROM desirelines.activity_external_ids
                WHERE source = 'strava' AND external_id = :external_id
            """),
            {"external_id": str(_EXTERNAL_ID)},
        ).scalar_one()
        assert recreated_id != activity_id

    def test_activity_insert_without_an_identity_override_is_rejected(self, db_session):
        with pytest.raises(ProgrammingError, match="GENERATED ALWAYS"):
            db_session.execute(
                text("""
                INSERT INTO desirelines.activities
                    (id, user_id, type, sport, start_date_local, year,
                     distance, moving_time, elapsed_time, source)
                VALUES (18000000001, '999', 'Run', 'Run', '2026-10-10', 2026,
                        1000, 100, 100, 'strava')
            """)
            )
