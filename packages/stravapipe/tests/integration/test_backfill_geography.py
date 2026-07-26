"""PostgreSQL integration coverage for backfill geography reconciliation."""

from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import text

from stravapipe.adapters.postgres import (
    SqlAlchemyActivityRepository,
    SqlAlchemyUnitOfWork,
)
from stravapipe.application.backfill import BackfillService, PostgresWriteStats
from stravapipe.domain import StandardActivity, SummaryMap, SummaryStravaActivity
from stravapipe.domain.activity import MetaAthlete
from stravapipe.ports.out.read import ReadDetailedActivities

VALID_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
ORIGINAL_ROUTE = (
    '{"type":"LineString","coordinates":[[-30.5,-0.5],[-30,0],[-29.5,0.5]]}'
)
TEST_REGION_WKT = "POLYGON((-31 -1, -29 -1, -29 1, -31 1, -31 -1))"


def make_summary_activity(
    activity_id: int,
    *,
    manual: bool = False,
    summary_polyline: str = VALID_POLYLINE,
) -> SummaryStravaActivity:
    """Create a representative activity from Strava's bulk-list endpoint."""
    return SummaryStravaActivity(
        id=activity_id,
        resource_state=2,
        athlete=MetaAthlete(id=999, resource_state=1),
        name="Morning Run",
        type="Run",
        sport_type="Run",
        distance=5000.0,
        moving_time=1800,
        elapsed_time=2000,
        total_elevation_gain=50.0,
        start_date=datetime(2024, 3, 15, 12, 0, tzinfo=UTC),
        start_date_local=datetime(2024, 3, 15, 7, 30, tzinfo=UTC),
        timezone="(GMT-05:00) America/New_York",
        start_latlng=[40.7, -74.0],
        end_latlng=[40.71, -74.01],
        achievement_count=0,
        kudos_count=0,
        comment_count=0,
        athlete_count=1,
        photo_count=0,
        has_kudoed=False,
        map=SummaryMap(
            id=f"a{activity_id}",
            summary_polyline=summary_polyline,
            resource_state=2,
        ),
        trainer=False,
        commute=False,
        manual=manual,
        private=False,
        flagged=False,
        average_speed=2.78,
        max_speed=3.5,
    )


def make_service(session_factory) -> BackfillService:
    """Build the real service/UoW composition against the test transaction."""
    return BackfillService(
        strava_reader=MagicMock(spec=ReadDetailedActivities),
        uow_factory=lambda: SqlAlchemyUnitOfWork(session_factory),
    )


def insert_test_region(db_session, *, code: str) -> int:
    """Insert an isolated region intersecting ORIGINAL_ROUTE."""
    row = db_session.execute(
        text("""
            INSERT INTO desirelines.regions
                (source, region_code, region_kind, region_name, geom)
            VALUES ('backfill_test', :code, 'county', 'Backfill Test Region',
                    ST_Multi(ST_GeomFromText(:wkt, 4326)))
            RETURNING id
        """),
        {"code": code, "wkt": TEST_REGION_WKT},
    ).fetchone()
    assert row is not None
    return row[0]


def route_hex(db_session, activity_id: int) -> str:
    """Return an exact EWKB representation for route-preservation assertions."""
    row = db_session.execute(
        text("""
            SELECT encode(ST_AsEWKB(route), 'hex')
            FROM desirelines.activity_routes
            WHERE activity_id = :activity_id
        """),
        {"activity_id": activity_id},
    ).fetchone()
    assert row is not None
    return row[0]


def tagged_region_ids(db_session, activity_id: int) -> list[int]:
    """Return all persisted region tags for an activity."""
    return [
        row[0]
        for row in db_session.execute(
            text("""
                SELECT region_id
                FROM desirelines.activity_regions
                WHERE activity_id = :activity_id
                ORDER BY region_id
            """),
            {"activity_id": activity_id},
        ).fetchall()
    ]


def activity_manual(db_session, activity_id: int) -> bool:
    """Return the persisted non-geographic manual flag."""
    row = db_session.execute(
        text("""
            SELECT manual
            FROM desirelines.activities
            WHERE id = :activity_id
        """),
        {"activity_id": activity_id},
    ).fetchone()
    assert row is not None
    return row[0]


class TestBackfillGeographyIntegration:
    """Exercise service ordering and transactions against real PostGIS tables."""

    def test_real_to_non_geographic_to_real_preserves_route_and_retags(
        self,
        uow,
        db_session,
        session_factory,
    ):
        """Both classification transitions retain the first-write-wins route."""
        activity_id = 230001
        test_region_id = insert_test_region(db_session, code="transition")
        seed = StandardActivity.model_validate(
            make_summary_activity(activity_id),
            from_attributes=True,
        )

        with uow:
            assert uow.activities.upsert(seed, None) is True
            assert uow.activities.insert_route(activity_id, ORIGINAL_ROUTE) is True
            assert uow.activities.tag_activity_regions(activity_id) >= 1
            uow.commit()

        original_route_hex = route_hex(db_session, activity_id)
        assert test_region_id in tagged_region_ids(db_session, activity_id)

        service = make_service(session_factory)
        non_geographic_stats = service._insert_to_postgres(
            [make_summary_activity(activity_id, manual=True)]
        )

        assert non_geographic_stats == PostgresWriteStats(updated=1)
        assert activity_manual(db_session, activity_id) is True
        assert route_hex(db_session, activity_id) == original_route_hex
        assert tagged_region_ids(db_session, activity_id) == []

        geographic_stats = service._insert_to_postgres(
            [
                make_summary_activity(
                    activity_id,
                    manual=False,
                    # A valid but different incoming route must lose the conflict.
                    summary_polyline=VALID_POLYLINE,
                )
            ]
        )

        assert geographic_stats == PostgresWriteStats(updated=1)
        assert activity_manual(db_session, activity_id) is False
        assert route_hex(db_session, activity_id) == original_route_hex
        assert test_region_id in tagged_region_ids(db_session, activity_id)

    @pytest.mark.parametrize(
        "failing_operation", ["insert_route", "tag_activity_regions"]
    )
    def test_geography_failure_rolls_back_every_row_in_real_batch(
        self,
        db_session,
        session_factory,
        failing_operation: str,
    ):
        """A second-activity geography failure rolls back all three tables."""
        activity_ids = [230101, 230102]
        activities = [
            make_summary_activity(activity_id) for activity_id in activity_ids
        ]
        original_operation = getattr(
            SqlAlchemyActivityRepository,
            failing_operation,
        )

        def fail_on_second_activity(
            repository: SqlAlchemyActivityRepository,
            activity_id: int,
            *args: Any,
        ) -> Any:
            if activity_id == activity_ids[1]:
                raise RuntimeError(f"{failing_operation} failed")
            return original_operation(repository, activity_id, *args)

        service = make_service(session_factory)
        with patch.object(
            SqlAlchemyActivityRepository,
            failing_operation,
            new=fail_on_second_activity,
        ):
            stats = service._insert_to_postgres(activities)

        assert stats == PostgresWriteStats(errors=2)
        for table in ("activity_regions", "activity_routes", "activities"):
            count = db_session.execute(
                text(
                    f"SELECT count(*) FROM desirelines.{table} "
                    "WHERE activity_id = ANY(:activity_ids)"
                    if table != "activities"
                    else "SELECT count(*) FROM desirelines.activities "
                    "WHERE id = ANY(:activity_ids)"
                ),
                {"activity_ids": activity_ids},
            ).scalar_one()
            assert count == 0
