"""Historical compatibility (V0014) and final activity-ID cleanup (V0015).

The migration must accept the deployed writer's tombstone SQL before the new
image rolls out. The compatibility writer must work after the real final migration.
Schema changes below are transactional and rolled back by db_session.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError, ProgrammingError

from stravapipe.adapters.postgres import SqlAlchemyActivityRepository
from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete
from stravapipe.ports.out.postgres import (
    BackfillUpsertResult,
    DeleteResult,
    InsertResult,
)
from tests.integration.helpers import (
    activity_id_for,
    database_resource,
    migrated_database,
    upsert_legacy_tombstone,
)


@pytest.fixture(scope="module")
def engine(db_url):
    with migrated_database(db_url, 14) as historical:
        yield historical


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

        db_session.execute(
            text(
                database_resource(
                    "migrations/V0014__activity_id_cleanup_compatibility.sql"
                ).read_text()
            )
        )

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
        # Run the real final migration, not a parallel test-only DDL sketch.
        db_session.execute(
            text(
                database_resource(
                    "migrations/V0015__activity_id_cleanup.sql"
                ).read_text()
            )
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


class TestFinalMigration:
    def test_preserves_existing_identity_and_tombstone_metadata(self, db_session):
        repo = SqlAlchemyActivityRepository(db_session)
        assert repo.insert(_activity(), 100) is InsertResult.INSERTED
        internal_id = activity_id_for(db_session, _EXTERNAL_ID)
        upsert_legacy_tombstone(db_session, _EXTERNAL_ID + 1, 200)
        before = dict(
            db_session.execute(
                text("""
            SELECT source, external_id, deleted_at, deletion_event_time,
                   deletion_correlation_id FROM desirelines.deleted_activities
            WHERE source = 'strava' AND external_id = :external_id
        """),
                {"external_id": str(_EXTERNAL_ID + 1)},
            )
            .one()
            ._mapping
        )

        db_session.execute(
            text(
                database_resource(
                    "migrations/V0015__activity_id_cleanup.sql"
                ).read_text()
            )
        )

        after = dict(
            db_session.execute(
                text("""
            SELECT * FROM desirelines.deleted_activities
            WHERE source = 'strava' AND external_id = :external_id
        """),
                {"external_id": str(_EXTERNAL_ID + 1)},
            )
            .one()
            ._mapping
        )
        assert after == before
        assert activity_id_for(db_session, _EXTERNAL_ID) == internal_id
        assert (
            db_session.execute(
                text("""
            SELECT last_event_time FROM desirelines.activities WHERE id = :id
        """),
                {"id": internal_id},
            ).scalar_one()
            == 100
        )
        assert db_session.execute(
            text("""
            SELECT to_regprocedure('desirelines.bridge_legacy_tombstone_id()'),
                   to_regprocedure('desirelines.rekey_adopted_activities()')
        """)
        ).one() == (None, None)
        assert (
            db_session.execute(
                text("""
            SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conrelid = 'desirelines.deleted_activities'::regclass
              AND contype = 'p'
        """)
            ).scalar_one()
            == "PRIMARY KEY (source, external_id)"
        )

        # Equal external IDs from different sources and nonnumeric IDs no
        # longer pass through a bigint bridge or collide on the legacy key.
        db_session.execute(text("SET LOCAL ROLE desirelines_dml_grp"))
        db_session.execute(
            text("""
            INSERT INTO desirelines.deleted_activities
                (source, external_id, deletion_event_time)
            VALUES ('other', :external_id, 300), ('other', 'uuid-example', 300)
        """),
            {"external_id": str(_EXTERNAL_ID + 1)},
        )
        assert repo.delete(_EXTERNAL_ID, 200) is DeleteResult.DELETED

    def test_refuses_to_retire_the_helper_while_adopted_ids_remain(self, db_session):
        db_session.execute(
            text("""
            INSERT INTO desirelines.activities
                (id, user_id, type, sport, start_date_local, year, source,
                 distance, moving_time, elapsed_time)
            VALUES (:id, '999', 'Run', 'Run', '2026-10-10', 2026, 'strava', 1000, 100, 100)
        """),
            {"id": _EXTERNAL_ID},
        )
        db_session.execute(
            text("""
            INSERT INTO desirelines.activity_external_ids
                (source, external_id, activity_id)
            VALUES ('strava', :external_id, :id)
        """),
            {"id": _EXTERNAL_ID, "external_id": str(_EXTERNAL_ID)},
        )
        with (
            pytest.raises(DBAPIError, match="requires zero adopted IDs"),
            db_session.begin_nested(),
        ):
            db_session.execute(
                text(
                    database_resource(
                        "migrations/V0015__activity_id_cleanup.sql"
                    ).read_text()
                )
            )
        assert db_session.execute(
            text("""
            SELECT to_regprocedure('desirelines.rekey_adopted_activities()') IS NOT NULL
        """)
        ).scalar_one()
        assert (
            db_session.execute(
                text("""
            SELECT attidentity FROM pg_attribute
            WHERE attrelid = 'desirelines.activities'::regclass AND attname = 'id'
        """)
            ).scalar_one()
            == "d"
        )
        assert (
            db_session.execute(
                text("""
            SELECT id FROM desirelines.deleted_activities LIMIT 0
        """)
            ).all()
            == []
        )

    def test_local_seed_allocates_mappings_once_under_final_identity(self, db_session):
        db_session.execute(
            text(
                database_resource(
                    "migrations/V0015__activity_id_cleanup.sql"
                ).read_text()
            )
        )
        seed = database_resource("local/R__01_seed_data.sql").read_text()
        db_session.execute(text(seed))
        rows = db_session.execute(
            text("""
            SELECT a.id, m.external_id FROM desirelines.activities a
            JOIN desirelines.activity_external_ids m ON m.activity_id = a.id
            WHERE a.user_id = '123456789' ORDER BY m.external_id
        """)
        ).all()
        assert len(rows) == 1000
        assert all(str(row.id) != row.external_id for row in rows)
        assert {row.external_id for row in rows} == {
            str(id_) for id_ in range(1130, 2130)
        }
        sequence = db_session.execute(
            text("SELECT last_value FROM desirelines.activities_id_seq")
        ).scalar_one()
        db_session.execute(text(seed))
        assert (
            db_session.execute(
                text("""
            SELECT a.id, m.external_id FROM desirelines.activities a
            JOIN desirelines.activity_external_ids m ON m.activity_id = a.id
            WHERE a.user_id = '123456789' ORDER BY m.external_id
        """)
            ).all()
            == rows
        )
        assert (
            db_session.execute(
                text("SELECT last_value FROM desirelines.activities_id_seq")
            ).scalar_one()
            == sequence
        )
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
