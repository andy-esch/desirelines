"""Integration tests for re-keying activities onto desirelines IDs (V0012).

``desirelines.rekey_adopted_activities()`` is what V0012 ran, and what renumbers
any activity still keyed by its Strava ID ("adopted") later on. Each test loads
legacy-shaped rows, as every activity was before V0012, and re-keys them.

Each test first re-keys whatever is already adopted in the database (leftovers,
locally ingested activities), so it counts only its own rows. The tests roll
back, but the ID sequence they advance does not (sequences are not
transactional); that only leaves a gap in future IDs.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete
from stravapipe.ports.out.postgres import InsertResult, MetadataUpdateResult

# Strava-sized IDs, clear of the local seed and other fixtures. They run
# opposite to the dates the tests give them, so ID order is never date order.
_OLDEST, _MIDDLE, _NEWEST = 17_000_000_003, 17_000_000_002, 17_000_000_001


def _insert_adopted(session, strava_id: int, start: str) -> None:
    """An activity keyed by its Strava ID, with that ID's mapping."""
    _insert_activity(session, strava_id, start)
    _insert_mapping(session, str(strava_id), strava_id)


def _insert_activity(session, activity_id: int, start: str) -> None:
    session.execute(
        text("""
            INSERT INTO desirelines.activities
                (id, user_id, type, sport, start_date_local, year,
                 distance, moving_time, elapsed_time, source)
            VALUES (:id, 'rekey-test', 'Ride', 'Ride', :start, 2026,
                    1000, 100, 100, 'strava')
        """),
        {"id": activity_id, "start": start},
    )


def _insert_mapping(session, external_id: str, activity_id: int) -> None:
    session.execute(
        text("""
            INSERT INTO desirelines.activity_external_ids
                (source, external_id, activity_id, external_owner_id)
            VALUES ('strava', :external_id, :activity_id, 'rekey-test')
        """),
        {"external_id": external_id, "activity_id": activity_id},
    )


def _rekey(session) -> int:
    return session.execute(
        text("SELECT desirelines.rekey_adopted_activities()")
    ).scalar_one()


def _clean_start(session) -> int:
    """Re-key any adopted leftovers; return the last desirelines ID in use."""
    _rekey(session)
    return session.execute(
        text("""
            SELECT GREATEST(
                (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END
                   FROM desirelines.activities_id_seq),
                (SELECT COALESCE(max(id), 0) FROM desirelines.activities)
            )
        """)
    ).scalar_one()


def _ids_by_strava_id(session, *strava_ids: int) -> dict[int, int]:
    rows = session.execute(
        text("""
            SELECT external_id::bigint, activity_id
            FROM desirelines.activity_external_ids
            WHERE source = 'strava' AND external_id = ANY(:external_ids)
        """),
        {"external_ids": [str(strava_id) for strava_id in strava_ids]},
    ).all()
    return dict(rows)


class TestRekeyAdoptedActivities:
    """V0012: renumbering activities still keyed by their Strava ID."""

    def test_rekeys_in_date_order_after_every_existing_id(self, db_session):
        last = _clean_start(db_session)
        _insert_adopted(db_session, _NEWEST, "2026-05-03 08:00:00")
        _insert_adopted(db_session, _OLDEST, "2026-05-01 08:00:00")
        _insert_adopted(db_session, _MIDDLE, "2026-05-02 08:00:00")

        assert _rekey(db_session) == 3

        assert _ids_by_strava_id(db_session, _OLDEST, _MIDDLE, _NEWEST) == {
            _OLDEST: last + 1,
            _MIDDLE: last + 2,
            _NEWEST: last + 3,
        }
        assert last + 1 >= 1_000_000  # the desirelines range

    def test_moves_the_sequence_past_the_ids_it_assigns(self, db_session):
        last = _clean_start(db_session)
        _insert_adopted(db_session, _OLDEST, "2026-05-01 08:00:00")
        _insert_adopted(db_session, _NEWEST, "2026-05-03 08:00:00")

        _rekey(db_session)

        next_id = db_session.execute(
            text("SELECT nextval('desirelines.activities_id_seq')")
        ).scalar_one()
        assert next_id == last + 3

    def test_numbers_past_a_desirelines_id_above_the_sequence(self, db_session):
        last = _clean_start(db_session)
        # Already re-keyed, and above anything the sequence has handed out.
        _insert_activity(db_session, last + 10, "2026-04-01 08:00:00")
        _insert_mapping(db_session, "17000000099", last + 10)
        _insert_adopted(db_session, _OLDEST, "2026-05-01 08:00:00")

        _rekey(db_session)

        assert _ids_by_strava_id(db_session, _OLDEST) == {_OLDEST: last + 11}

    def test_a_strava_id_inside_the_new_range_does_not_collide(self, db_session):
        # Old Strava IDs can be 7 digits; one may hold the very ID the re-key
        # assigns to an earlier activity, so the renumber must not go row by row.
        last = _clean_start(db_session)
        _insert_adopted(db_session, last + 1, "2026-05-02 08:00:00")
        _insert_adopted(db_session, _OLDEST, "2026-05-01 08:00:00")

        assert _rekey(db_session) == 2
        assert _ids_by_strava_id(db_session, _OLDEST, last + 1) == {
            _OLDEST: last + 1,
            last + 1: last + 2,
        }

    def test_routes_tags_and_mappings_follow_and_tombstones_stay(self, db_session):
        _clean_start(db_session)
        _insert_adopted(db_session, _OLDEST, "2026-05-01 08:00:00")
        db_session.execute(
            text("""
                INSERT INTO desirelines.activity_routes (activity_id, route)
                VALUES (:id, ST_Multi(ST_GeomFromText('LINESTRING(-30 0, -29 1)', 4326)))
            """),
            {"id": _OLDEST},
        )
        db_session.execute(
            text("""
                INSERT INTO desirelines.activity_regions (activity_id, region_id)
                SELECT :id, id FROM desirelines.regions
                WHERE source = 'builtin' AND region_code = 'earth'
            """),
            {"id": _OLDEST},
        )
        # A tombstone for the same Strava ID (a deletion before a re-creation).
        db_session.execute(
            text("""
                INSERT INTO desirelines.deleted_activities
                    (id, source, deletion_event_time)
                VALUES (:id, 'strava', 1700000000)
            """),
            {"id": _OLDEST},
        )

        _rekey(db_session)

        rekeyed = _ids_by_strava_id(db_session, _OLDEST)[_OLDEST]
        assert rekeyed != _OLDEST
        for table in ("activity_routes", "activity_regions"):
            count = db_session.execute(
                text(
                    f"SELECT count(*) FROM desirelines.{table} WHERE activity_id = :id"
                ),
                {"id": rekeyed},
            ).scalar_one()
            assert count == 1, table
        tombstones = (
            db_session.execute(
                text("""
                    SELECT id FROM desirelines.deleted_activities
                    WHERE id IN (:strava_id, :rekeyed)
                """),
                {"strava_id": _OLDEST, "rekeyed": rekeyed},
            )
            .scalars()
            .all()
        )
        assert tombstones == [_OLDEST]  # still keyed by the Strava ID

    def test_a_second_run_renumbers_nothing(self, db_session):
        _clean_start(db_session)
        _insert_adopted(db_session, _OLDEST, "2026-05-01 08:00:00")
        _rekey(db_session)
        rekeyed = _ids_by_strava_id(db_session, _OLDEST)

        assert _rekey(db_session) == 0
        assert _ids_by_strava_id(db_session, _OLDEST) == rekeyed

    def test_writers_find_a_rekeyed_activity_by_its_strava_id(self, uow, db_session):
        _clean_start(db_session)
        activity = StandardActivity(
            id=_OLDEST,
            athlete=MetaAthlete(id=17_042, resource_state=1),
            name="Before",
            type="Ride",
            sport_type="Ride",
            start_date_local=datetime(2026, 5, 1, 8, 0, 0, tzinfo=UTC),
            distance=1000.0,
            moving_time=100,
            elapsed_time=100,
        )
        with uow:
            uow.activities.insert(activity, 100)
            uow.commit()
        _rekey(db_session)
        rekeyed = _ids_by_strava_id(db_session, _OLDEST)[_OLDEST]

        with uow:
            assert uow.activities.insert(activity, 100) is InsertResult.ALREADY_EXISTS
            assert (
                uow.activities.update_metadata(_OLDEST, {"title": "After"}, 200)
                is MetadataUpdateResult.UPDATED
            )
            uow.commit()

        rows = db_session.execute(
            text("SELECT id, name FROM desirelines.activities WHERE user_id = '17042'")
        ).all()
        assert [tuple(row) for row in rows] == [(rekeyed, "After")]

    def test_only_migrations_may_rekey(self, db_session):
        db_session.execute(text("SET LOCAL ROLE desirelines_dml_grp"))

        with pytest.raises(ProgrammingError, match="permission denied"):
            _rekey(db_session)


class TestStravaIdsInsideTheDesirelinesRange:
    """A Strava ID can equal an existing desirelines ID (old 7-digit IDs)."""

    @pytest.mark.xfail(
        strict=True,
        reason=(
            "Known gap: a new activity still takes its Strava ID as its ID, so "
            "one equal to an existing activity's desirelines ID is mapped onto "
            "that activity. Allocating new IDs from the sequence closes it; "
            "then remove this marker."
        ),
    )
    def test_a_new_activity_never_claims_an_existing_one(self, uow, db_session):
        last = _clean_start(db_session)
        _insert_adopted(db_session, _OLDEST, "2026-05-01 08:00:00")
        _rekey(db_session)  # _OLDEST now holds desirelines ID last + 1
        newcomer = StandardActivity(
            id=last + 1,  # another athlete's 2009-era Strava ID
            athlete=MetaAthlete(id=17_043, resource_state=1),
            name="Old ride",
            type="Ride",
            sport_type="Ride",
            start_date_local=datetime(2009, 6, 1, 8, 0, 0, tzinfo=UTC),
            distance=1000.0,
            moving_time=100,
            elapsed_time=100,
        )

        with uow:
            result = uow.activities.insert(newcomer, 100)
            uow.commit()

        assert result is InsertResult.INSERTED
        claimed = _ids_by_strava_id(db_session, last + 1)[last + 1]
        assert claimed != _ids_by_strava_id(db_session, _OLDEST)[_OLDEST]
