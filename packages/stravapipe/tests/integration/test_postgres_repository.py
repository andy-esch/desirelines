"""Integration tests for PostgreSQL activity repository.

Run with: pytest tests/integration/ -v
Requires: PostgreSQL running (docker compose --profile backend up postgres flyway)
"""

from datetime import UTC, datetime
import logging

from sqlalchemy import event, text
from sqlalchemy.exc import SQLAlchemyError

from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete


def make_activity(
    activity_id: int = 12345,
    user_id: int = 999,
    name: str = "Morning Run",
) -> StandardActivity:
    """Create test activity."""
    return StandardActivity(
        id=activity_id,
        athlete=MetaAthlete(id=user_id, resource_state=1),
        name=name,
        type="Run",
        sport_type="Run",
        start_date_local=datetime(2024, 1, 15, 7, 30, 0, tzinfo=UTC),
        distance=5000.0,
        moving_time=1800,
        elapsed_time=2000,
        total_elevation_gain=50.0,
    )


class TestActivityRepository:
    """Integration tests for SqlAlchemyActivityRepository."""

    def test_insert_new_activity(self, uow):
        """Insert creates new activity."""
        activity = make_activity(activity_id=100001)

        with uow:
            result = uow.activities.insert(activity)
            uow.commit()

        assert result is True

    def test_insert_duplicate_returns_false(self, uow):
        """Insert returns False for duplicate (ON CONFLICT DO NOTHING)."""
        activity = make_activity(activity_id=100002)

        with uow:
            # First insert
            result1 = uow.activities.insert(activity)
            uow.commit()

        with uow:
            # Second insert - should return False
            result2 = uow.activities.insert(activity)
            uow.commit()

        assert result1 is True
        assert result2 is False

    def test_exists_returns_true_for_existing(self, uow):
        """exists() returns True after insert."""
        activity = make_activity(activity_id=100003)

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            exists = uow.activities.exists(100003)

        assert exists is True

    def test_exists_returns_false_for_missing(self, uow):
        """exists() returns False for non-existent activity."""
        with uow:
            exists = uow.activities.exists(999999)

        assert exists is False

    def test_update_metadata_changes_name(self, uow, db_session):
        """update_metadata updates name column."""
        activity = make_activity(activity_id=100004)

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            result = uow.activities.update_metadata(100004, {"title": "Evening Run"})
            uow.commit()

        assert result is True

        # Verify in database
        row = db_session.execute(
            text("SELECT name FROM desirelines.activities WHERE id = :id"),
            {"id": 100004},
        ).fetchone()
        assert row.name == "Evening Run"

    def test_update_metadata_type_does_not_clobber_sport(self, uow, db_session):
        """A bare `type` update writes `type` only and leaves `sport` intact.

        Strava's UPDATE webhook sends the broad `type` ("Ride") but not the
        granular `sport_type` ("MountainBikeRide") that the `sport` column
        holds. Writing the broad type into `sport` would corrupt the granular
        value and break GROUP BY, so `update_metadata` must not touch `sport`.
        The enriched (re-fetched) path uses `upsert` to refresh `sport`.
        """
        # CREATE-time sport is the granular sport_type ("MountainBikeRide").
        activity = make_activity(activity_id=100005)
        activity = activity.model_copy(update={"sport_type": "MountainBikeRide"})

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            result = uow.activities.update_metadata(100005, {"type": "Ride"})
            uow.commit()

        assert result is True

        row = db_session.execute(
            text("SELECT type, sport FROM desirelines.activities WHERE id = :id"),
            {"id": 100005},
        ).fetchone()
        assert row.type == "Ride"  # broad type updated
        assert row.sport == "MountainBikeRide"  # granular sport preserved

    def test_upsert_refreshes_sport_on_existing_row(self, uow, db_session):
        """upsert refreshes every column (incl. granular `sport`), keeps created_at."""
        # Existing row from CREATE.
        original = make_activity(activity_id=100007, name="Old Name")
        original = original.model_copy(update={"sport_type": "Run"})
        with uow:
            uow.activities.insert(original)
            uow.commit()

        created_row = db_session.execute(
            text("SELECT created_at FROM desirelines.activities WHERE id = :id"),
            {"id": 100007},
        ).fetchone()

        # Re-fetched activity after a type change Run -> MountainBikeRide.
        refreshed = make_activity(activity_id=100007, name="New Name")
        refreshed = refreshed.model_copy(
            update={"type": "Ride", "sport_type": "MountainBikeRide"}
        )
        with uow:
            result = uow.activities.upsert(refreshed)
            uow.commit()

        assert result is True
        row = db_session.execute(
            text(
                "SELECT name, type, sport, created_at "
                "FROM desirelines.activities WHERE id = :id"
            ),
            {"id": 100007},
        ).fetchone()
        assert row.name == "New Name"
        assert row.type == "Ride"
        assert row.sport == "MountainBikeRide"  # granular value refreshed
        assert row.created_at == created_row.created_at  # preserved on conflict

    def test_upsert_inserts_when_missing(self, uow, db_session):
        """upsert inserts a row that doesn't exist yet (UPDATE before CREATE)."""
        activity = make_activity(activity_id=100008)
        activity = activity.model_copy(update={"sport_type": "GravelRide"})

        with uow:
            result = uow.activities.upsert(activity)
            uow.commit()

        assert result is True
        row = db_session.execute(
            text("SELECT sport FROM desirelines.activities WHERE id = :id"),
            {"id": 100008},
        ).fetchone()
        assert row.sport == "GravelRide"

    def test_update_metadata_returns_false_for_missing(self, uow):
        """update_metadata returns False for non-existent activity."""
        with uow:
            result = uow.activities.update_metadata(999999, {"title": "New"})
            uow.commit()

        assert result is False

    def test_delete_removes_activity(self, uow):
        """delete removes activity from database."""
        activity = make_activity(activity_id=100006)

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            result = uow.activities.delete(100006)
            uow.commit()

        assert result is True

        with uow:
            exists = uow.activities.exists(100006)

        assert exists is False

    def test_delete_returns_false_for_missing(self, uow):
        """delete returns False for non-existent activity."""
        with uow:
            result = uow.activities.delete(999999)
            uow.commit()

        assert result is False

    def test_get_existing_ids(self, uow):
        """get_existing_ids filters a list of IDs and returns only those that exist."""
        activity1 = make_activity(activity_id=100021)
        activity2 = make_activity(activity_id=100022)

        with uow:
            uow.activities.insert(activity1)
            uow.activities.insert(activity2)
            uow.commit()

        with uow:
            existing = uow.activities.get_existing_ids([100021, 100022, 100023, 999999])

        assert existing == {100021, 100022}

    def test_get_existing_ids_empty(self, uow):
        """get_existing_ids returns an empty set when passed an empty list."""
        with uow:
            existing = uow.activities.get_existing_ids([])
        assert existing == set()


class TestActivityRouteRepository:
    """Integration tests for activity route geometry storage."""

    def test_insert_route_happy_path(self, uow, db_session):
        """insert_route stores geometry and is queryable with PostGIS."""
        activity = make_activity(activity_id=300001)
        geojson = '{"type":"LineString","coordinates":[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]}'

        with uow:
            uow.activities.insert(activity)
            result = uow.activities.insert_route(300001, geojson)
            uow.commit()

        assert result is True

        # Verify geometry stored correctly via ST_AsGeoJSON
        row = db_session.execute(
            text(
                "SELECT ST_AsGeoJSON(route)::json->>'type' as geom_type, "
                "ST_NPoints(route) as npoints "
                "FROM desirelines.activity_routes WHERE activity_id = :id"
            ),
            {"id": 300001},
        ).fetchone()
        assert row.geom_type == "LineString"
        assert row.npoints == 3

    def test_insert_route_duplicate_returns_false(self, uow):
        """insert_route returns False for duplicate (ON CONFLICT DO NOTHING)."""
        activity = make_activity(activity_id=300002)
        geojson = '{"type":"LineString","coordinates":[[-120.2,38.5],[-120.95,40.7]]}'

        with uow:
            uow.activities.insert(activity)
            result1 = uow.activities.insert_route(300002, geojson)
            uow.commit()

        with uow:
            result2 = uow.activities.insert_route(300002, geojson)
            uow.commit()

        assert result1 is True
        assert result2 is False

    def test_delete_activity_cascades_to_route(self, uow, db_session):
        """Deleting an activity cascades to its route."""
        activity = make_activity(activity_id=300003)
        geojson = '{"type":"LineString","coordinates":[[-120.2,38.5],[-120.95,40.7]]}'

        with uow:
            uow.activities.insert(activity)
            uow.activities.insert_route(300003, geojson)
            uow.commit()

        with uow:
            uow.activities.delete(300003)
            uow.commit()

        row = db_session.execute(
            text("SELECT 1 FROM desirelines.activity_routes WHERE activity_id = :id"),
            {"id": 300003},
        ).fetchone()
        assert row is None


def _insert_test_region(session, *, code: str, wkt: str, kind: str = "county") -> int:
    """Insert a controlled test region (rolled back with the test) and return id.

    Placed in the mid-Atlantic in the tests below so it never overlaps the real
    US Census boundaries that may be loaded in the same database.
    """
    row = session.execute(
        text("""
            INSERT INTO desirelines.regions
                (source, region_code, region_kind, region_name, geom)
            VALUES ('test_regions', :code, :kind, 'Test Region',
                    ST_Multi(ST_GeomFromText(:wkt, 4326)))
            RETURNING id
        """),
        {"code": code, "kind": kind, "wkt": wkt},
    ).fetchone()
    return row[0]


# A 2x2 degree box around (-30, 0), far from any real US Census region.
_TEST_REGION_WKT = "POLYGON((-31 -1, -29 -1, -29 1, -31 1, -31 -1))"


def _tagged_region_ids(session, activity_id: int) -> list[int]:
    rows = session.execute(
        text(
            "SELECT region_id FROM desirelines.activity_regions "
            "WHERE activity_id = :id ORDER BY region_id"
        ),
        {"id": activity_id},
    ).fetchall()
    return [r[0] for r in rows]


class TestActivityRegionTagging:
    """Integration tests for tag_activity_regions (V0005 junction + earth)."""

    def test_persists_trainer_and_manual_flags(self, uow, db_session):
        """insert writes the new trainer/manual columns (V0006)."""
        activity = StandardActivity(
            id=210000,
            athlete=MetaAthlete(id=999, resource_state=1),
            name="Indoor Spin",
            type="VirtualRide",
            sport_type="VirtualRide",
            start_date_local=datetime(2024, 1, 15, 7, 30, 0, tzinfo=UTC),
            distance=20000.0,
            moving_time=3600,
            elapsed_time=3600,
            trainer=True,
            manual=False,
        )
        with uow:
            uow.activities.insert(activity)
            uow.commit()

        row = db_session.execute(
            text("SELECT trainer, manual FROM desirelines.activities WHERE id = :id"),
            {"id": 210000},
        ).fetchone()
        assert row == (True, False)

    def test_tags_every_intersecting_region(self, uow, db_session):
        """A route is tagged with the specific region(s) it intersects."""
        activity = make_activity(activity_id=210001)
        region_id = _insert_test_region(db_session, code="r1", wkt=_TEST_REGION_WKT)

        with uow:
            uow.activities.insert(activity)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-30.5,-0.5],[-30,0],[-29.5,0.5]]}',
            )
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 1
        assert _tagged_region_ids(db_session, activity.id) == [region_id]

    def test_earth_fallback_when_no_specific_region_matches(self, uow, db_session):
        """A route matching no specific region falls back to builtin 'earth'."""
        activity = make_activity(activity_id=210002)
        earth_id = db_session.execute(
            text(
                "SELECT id FROM desirelines.regions "
                "WHERE source='builtin' AND region_code='earth'"
            )
        ).fetchone()[0]

        with uow:
            uow.activities.insert(activity)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-45,0],[-44,0]]}',
            )
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 1
        assert _tagged_region_ids(db_session, activity.id) == [earth_id]

    def test_unloaded_regions_logs_and_degrades_to_earth(self, uow, db_session, caplog):
        """A routed fallback with no specific dataset is loud but still succeeds."""
        db_session.execute(
            text("DELETE FROM desirelines.regions WHERE region_kind <> 'global'")
        )
        activity = make_activity(activity_id=210006)

        with caplog.at_level(logging.ERROR), uow:
            uow.activities.insert(activity)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-45,0],[-44,0]]}',
            )
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 1
        assert "Regions table appears unloaded or incomplete" in caplog.text

    def test_off_grid_route_does_not_log_unloaded_when_region_floor_met(
        self, uow, db_session, caplog
    ):
        """A legitimate off-grid route is distinct from a broken region dataset."""
        db_session.execute(
            text("DELETE FROM desirelines.regions WHERE region_kind <> 'global'")
        )
        db_session.execute(
            text("""
                INSERT INTO desirelines.regions
                    (source, region_code, region_kind, region_name, geom)
                SELECT
                    'test_floor',
                    'floor-' || n,
                    'county',
                    'Readiness Floor ' || n,
                    ST_Multi(ST_GeomFromText(
                        'POLYGON((-31 -1, -29 -1, -29 1, -31 1, -31 -1))',
                        4326
                    ))
                FROM generate_series(1, 100) AS n
            """)
        )
        activity = make_activity(activity_id=210007)

        with caplog.at_level(logging.ERROR), uow:
            uow.activities.insert(activity)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-45,0],[-44,0]]}',
            )
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 1
        assert "Regions table appears unloaded or incomplete" not in caplog.text

    def test_spatial_failure_preserves_existing_specific_tags(
        self, uow, db_session, caplog
    ):
        """The delete and spatial insert roll back together on a transient error."""
        activity = make_activity(activity_id=210008)
        region_id = _insert_test_region(
            db_session,
            code="atomic-retag",
            wkt=_TEST_REGION_WKT,
        )

        with uow:
            uow.activities.insert(activity)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-30.5,-0.5],[-29.5,0.5]]}',
            )
            assert uow.activities.tag_activity_regions(activity.id) == 1
            uow.commit()

        connection = db_session.connection()

        def fail_spatial_insert(
            conn, cursor, statement, parameters, context, executemany
        ):
            del conn, cursor, parameters, context, executemany
            if "ST_Intersects" in statement:
                raise SQLAlchemyError("forced spatial failure")

        event.listen(connection, "before_cursor_execute", fail_spatial_insert)
        try:
            with caplog.at_level(logging.WARNING), uow:
                count = uow.activities.tag_activity_regions(activity.id)
                uow.commit()
        finally:
            event.remove(connection, "before_cursor_execute", fail_spatial_insert)

        assert count == 0
        assert "Region spatial tagging failed" in caplog.text
        assert _tagged_region_ids(db_session, activity.id) == [region_id]

    def test_no_route_means_no_tags(self, uow, db_session):
        """An activity without a route gets no region rows (not even earth)."""
        activity = make_activity(activity_id=210003)

        with uow:
            uow.activities.insert(activity)
            count = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert count == 0
        assert _tagged_region_ids(db_session, activity.id) == []

    def test_tagging_is_idempotent(self, uow, db_session):
        """Re-tagging clears and rewrites — no duplicate rows."""
        activity = make_activity(activity_id=210004)
        region_id = _insert_test_region(db_session, code="r2", wkt=_TEST_REGION_WKT)

        with uow:
            uow.activities.insert(activity)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-30,0],[-29.5,0.2]]}',
            )
            first = uow.activities.tag_activity_regions(activity.id)
            second = uow.activities.tag_activity_regions(activity.id)
            uow.commit()

        assert first == 1
        assert second == 1
        assert _tagged_region_ids(db_session, activity.id) == [region_id]

    def test_clear_activity_regions_removes_tags(self, uow, db_session):
        """clear_activity_regions deletes all tags (e.g. activity became virtual)."""
        activity = make_activity(activity_id=210005)
        _insert_test_region(db_session, code="r3", wkt=_TEST_REGION_WKT)

        with uow:
            uow.activities.insert(activity)
            uow.activities.insert_route(
                activity.id,
                '{"type":"LineString","coordinates":[[-30,0],[-29.5,0.2]]}',
            )
            uow.activities.tag_activity_regions(activity.id)
            assert _tagged_region_ids(db_session, activity.id) != []

            deleted = uow.activities.clear_activity_regions(activity.id)
            uow.commit()

        assert deleted == 1
        assert _tagged_region_ids(db_session, activity.id) == []


class TestTransactionRollback:
    """Tests verifying transaction rollback works correctly."""

    def test_data_isolated_between_tests(self, uow):
        """Each test starts with clean slate due to rollback."""
        # This test creates an activity with specific ID
        activity = make_activity(activity_id=200001)

        with uow:
            uow.activities.insert(activity)
            uow.commit()

        with uow:
            exists = uow.activities.exists(200001)

        assert exists is True
        # After test, rollback removes this data

    def test_previous_test_data_not_visible(self, uow):
        """Previous test's data should not be visible (proves rollback)."""
        # ID 200001 was used in previous test - should not exist
        with uow:
            exists = uow.activities.exists(200001)

        assert exists is False
