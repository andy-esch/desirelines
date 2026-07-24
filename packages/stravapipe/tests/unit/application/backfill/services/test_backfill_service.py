"""Unit tests for BackfillService.

Tests the bulk backfill orchestration logic using mocked adapters:
- unittest.mock with spec= for interface compliance
- Arrange/Act/Assert structure
- Grouped by behavior
"""

from datetime import UTC, datetime
import json
from unittest.mock import MagicMock, call, create_autospec, patch

from google.api_core import exceptions as gapi_exceptions
import pytest

from stravapipe.adapters.gcp import ActivitiesWriter
from stravapipe.application.backfill.service import (
    BackfillResult,
    BackfillService,
    PostgresWriteStats,
    ProgressReporter,
    YearStats,
)
from stravapipe.domain.activity import (
    MetaAthlete,
    PolylineMap,
    StandardActivity,
    SummaryMap,
    SummaryStravaActivity,
)
from stravapipe.ports.out.postgres import ActivityRepository
from stravapipe.ports.out.read import ReadDetailedActivities
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork

# =============================================================================
# Test Fixtures
# =============================================================================

VALID_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


def make_summary_activity(
    activity_id: int = 12345,
    type_: str = "Run",
    sport_type: str = "Run",
    year: int = 2024,
    summary_polyline: str = VALID_POLYLINE,
    trainer: bool = False,
    manual: bool = False,
) -> SummaryStravaActivity:
    """Factory for creating test SummaryStravaActivity objects."""
    return SummaryStravaActivity(
        id=activity_id,
        resource_state=2,
        athlete=MetaAthlete(id=999, resource_state=1),
        name="Morning Run",
        type=type_,
        sport_type=sport_type,
        distance=5000.0,
        moving_time=1800,
        elapsed_time=2000,
        total_elevation_gain=50.0,
        start_date=datetime(year, 3, 15, 12, 0, 0, tzinfo=UTC),
        start_date_local=datetime(year, 3, 15, 7, 30, 0, tzinfo=UTC),
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
        trainer=trainer,
        commute=False,
        manual=manual,
        private=False,
        flagged=False,
        average_speed=2.78,
        max_speed=3.5,
    )


def make_standard_activity(
    activity_id: int = 12345,
    *,
    type_: str = "Run",
    sport_type: str = "Run",
    polyline: str | None = None,
    summary_polyline: str | None = VALID_POLYLINE,
    include_map: bool = True,
) -> StandardActivity:
    """Create a normalized activity for route-selection tests."""
    activity_map = None
    if include_map:
        activity_map = PolylineMap(
            id=f"a{activity_id}",
            polyline=polyline,
            summary_polyline=summary_polyline,
            resource_state=2,
        )
    return StandardActivity(
        id=activity_id,
        athlete=MetaAthlete(id=999, resource_state=1),
        name="Morning Run",
        type=type_,
        sport_type=sport_type,
        start_date_local=datetime(2024, 3, 15, 7, 30, tzinfo=UTC),
        distance=5000.0,
        moving_time=1800,
        elapsed_time=2000,
        map=activity_map,
    )


def make_activities(count: int, year: int = 2024) -> list[SummaryStravaActivity]:
    """Create a list of test activities."""
    return [make_summary_activity(activity_id=i + 1, year=year) for i in range(count)]


@pytest.fixture
def mock_activity_repo():
    """Mock activity repository with spec for interface compliance."""
    repository = create_autospec(ActivityRepository, instance=True)
    repository.get_existing_ids.return_value = set()
    repository.upsert.return_value = True
    return repository


@pytest.fixture
def mock_strava_reader():
    """Mock Strava reader with spec for interface compliance."""
    return create_autospec(ReadDetailedActivities, instance=True)


@pytest.fixture
def mock_uow(mock_activity_repo):
    """Mock Unit of Work with context manager support."""
    uow = MagicMock(spec=AbstractUnitOfWork)
    uow.activities = mock_activity_repo
    uow.__enter__.return_value = uow
    return uow


@pytest.fixture
def mock_uow_factory(mock_uow):
    """Factory that returns the mock UoW."""
    return MagicMock(return_value=mock_uow)


@pytest.fixture
def mock_bq_writer():
    """Mock BigQuery writer."""
    writer = create_autospec(ActivitiesWriter, instance=True)
    writer.write_activities_batch.return_value = {
        "rows_affected": 0,
        "execution_time_ms": 100,
        "job_id": "test",
        "query_preview": "",
    }
    return writer


@pytest.fixture
def mock_progress():
    """Mock progress reporter."""
    return create_autospec(ProgressReporter, instance=True)


@pytest.fixture
def service(mock_strava_reader, mock_uow_factory) -> BackfillService:
    """Configured service with mock dependencies (no BQ writer)."""
    return BackfillService(
        strava_reader=mock_strava_reader,
        uow_factory=mock_uow_factory,
    )


@pytest.fixture
def service_with_bq(
    mock_strava_reader, mock_uow_factory, mock_bq_writer
) -> BackfillService:
    """Configured service with BQ writer."""
    return BackfillService(
        strava_reader=mock_strava_reader,
        uow_factory=mock_uow_factory,
        bq_writer=mock_bq_writer,
    )


# =============================================================================
# Tests: Basic Backfill
# =============================================================================


@pytest.mark.parametrize("batch_size", [0, -1])
def test_rejects_non_positive_batch_size(
    mock_strava_reader,
    mock_uow_factory,
    batch_size: int,
):
    """Direct service construction cannot silently disable batch processing."""
    with pytest.raises(ValueError, match="batch_size must be greater than zero"):
        BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
            batch_size=batch_size,
        )


class TestBackfillUser:
    """Tests for BackfillService.backfill_user()."""

    def test_backfills_single_year(
        self,
        service: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
    ):
        """Backfills activities for a single year."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities

        result = service.backfill_user("12345", years=[2024])

        assert result.athlete_id == "12345"
        assert result.years == [2024]
        assert result.total_activities == 3
        assert result.total_pg_inserted == 3
        assert result.success is True
        mock_strava_reader.read_activities_by_year.assert_called_once_with(2024)

    def test_backfills_multiple_years_in_order(
        self,
        service: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
    ):
        """Years are processed in sorted order."""
        mock_strava_reader.read_activities_by_year.return_value = make_activities(2)
        mock_activity_repo.get_existing_ids.return_value = {1}

        result = service.backfill_user("12345", years=[2025, 2023, 2024])

        assert result.years == [2023, 2024, 2025]
        assert mock_strava_reader.read_activities_by_year.call_args_list == [
            call(2023),
            call(2024),
            call(2025),
        ]
        assert result.total_activities == 6  # 2 per year * 3 years
        assert result.total_pg_inserted == 3
        assert result.total_pg_updated == 3

    def test_handles_empty_year(
        self,
        service: BackfillService,
        mock_strava_reader,
    ):
        """Empty year (no activities) is handled gracefully."""
        mock_strava_reader.read_activities_by_year.return_value = []

        result = service.backfill_user("12345", years=[2020])

        assert result.total_activities == 0
        assert result.total_pg_inserted == 0
        assert result.success is True
        assert len(result.year_stats) == 1
        assert result.year_stats[0].activities_found == 0
        assert result.year_stats[0].duration_seconds >= 0

    def test_records_duration(
        self,
        service: BackfillService,
        mock_strava_reader,
    ):
        """Result includes timing information."""
        mock_strava_reader.read_activities_by_year.return_value = []

        result = service.backfill_user("12345", years=[2024])

        assert result.duration_seconds >= 0

    def test_empty_year_records_measured_duration(
        self,
        service: BackfillService,
        mock_strava_reader,
    ):
        """Empty years report measured elapsed time instead of the default zero."""
        mock_strava_reader.read_activities_by_year.return_value = []

        with patch(
            "stravapipe.application.backfill.service.time.monotonic",
            side_effect=[10.0, 12.5],
        ):
            stats = service._backfill_year(2024)

        assert stats.duration_seconds == 2.5


# =============================================================================
# Tests: PostgreSQL Insertion
# =============================================================================


class TestPostgresInsertion:
    """Tests for PostgreSQL batch insertion logic."""

    def test_inserts_activities_in_batches(
        self,
        mock_strava_reader,
        mock_uow_factory,
        mock_uow,
        mock_activity_repo,
    ):
        """Activities are inserted in batches of batch_size."""
        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
            batch_size=2,
        )
        activities = make_activities(5, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities

        result = service.backfill_user("12345", years=[2024])

        # 5 activities / batch_size 2 = 3 batches
        assert mock_uow_factory.call_count == 3
        assert mock_uow.commit.call_count == 3
        assert result.total_pg_inserted == 5
        assert mock_activity_repo.get_existing_ids.call_args_list == [
            call([1, 2]),
            call([3, 4]),
            call([5]),
        ]

    def test_classifies_existing_activities_as_updated(
        self,
        service: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
    ):
        """The batch pre-read classifies committed upserts as inserts or updates."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities
        mock_activity_repo.get_existing_ids.return_value = {2, 3}

        result = service.backfill_user("12345", years=[2024])

        assert result.total_pg_inserted == 1
        assert result.total_pg_updated == 2
        assert result.year_stats[0].pg_updated == 2
        assert result.success is True
        mock_activity_repo.get_existing_ids.assert_called_once_with([1, 2, 3])
        assert mock_activity_repo.upsert.call_count == 3

    def test_commit_failure_discards_batch_counts(
        self,
        service: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
        mock_uow,
    ):
        """A failed commit rolls back and classifies every activity as an error."""
        activities = make_activities(3)
        mock_strava_reader.read_activities_by_year.return_value = activities
        mock_activity_repo.get_existing_ids.return_value = {2}
        mock_uow.commit.side_effect = RuntimeError("commit failed")

        result = service.backfill_user("12345", years=[2024])

        year_stats = result.year_stats[0]
        assert year_stats.pg_inserted == 0
        assert year_stats.pg_updated == 0
        assert year_stats.pg_errors == 3
        assert (
            year_stats.pg_inserted + year_stats.pg_updated + year_stats.pg_errors
            == year_stats.activities_found
        )

    def test_post_commit_exit_failure_preserves_committed_counts(
        self,
        service: BackfillService,
        mock_activity_repo,
        mock_uow,
        caplog,
    ):
        """Cleanup failure after commit cannot reclassify durable writes."""
        activities = make_activities(3)
        mock_activity_repo.get_existing_ids.return_value = {2}
        mock_uow.__exit__.side_effect = RuntimeError("cleanup failed")

        with caplog.at_level(
            "ERROR",
            logger="stravapipe.application.backfill.service",
        ):
            stats = service._insert_to_postgres(activities)

        assert stats == PostgresWriteStats(inserted=2, updated=1, errors=0)
        assert stats.inserted + stats.updated + stats.errors == len(activities)
        assert "cleanup failed after commit (RuntimeError)" in caplog.text
        assert "2 inserted and 1 updated remain authoritative" in caplog.text

    def test_success_log_failure_preserves_committed_counts(
        self,
        service: BackfillService,
        mock_activity_repo,
    ):
        """A broken success logger cannot double-count a committed batch."""
        activities = make_activities(3)
        mock_activity_repo.get_existing_ids.return_value = {2}

        with patch(
            "stravapipe.application.backfill.service.logger.info",
            side_effect=RuntimeError("logging failed"),
        ):
            stats = service._insert_to_postgres(activities)

        assert stats == PostgresWriteStats(inserted=2, updated=1, errors=0)
        assert stats.inserted + stats.updated + stats.errors == len(activities)

    def test_false_upsert_fails_the_whole_transactional_batch(
        self,
        service: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
        mock_uow,
    ):
        """An unexpected false upsert cannot silently disappear from metrics."""
        mock_strava_reader.read_activities_by_year.return_value = make_activities(2)
        mock_activity_repo.upsert.side_effect = [True, False]

        result = service.backfill_user("12345", years=[2024])

        year_stats = result.year_stats[0]
        assert year_stats.pg_inserted == 0
        assert year_stats.pg_updated == 0
        assert year_stats.pg_errors == 2
        mock_uow.commit.assert_not_called()

    def test_batch_error_is_tracked(
        self,
        service: BackfillService,
        mock_strava_reader,
        mock_uow,
    ):
        """Exception during a batch is tracked as errors."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities
        mock_uow.__enter__.side_effect = RuntimeError("connection failed")

        result = service.backfill_user("12345", years=[2024])

        assert result.total_errors == 3  # All activities in failed batch
        assert result.success is False

    def test_creates_new_uow_per_batch(
        self,
        mock_strava_reader,
        mock_activity_repo,
    ):
        """Each batch gets a fresh UoW (not reused)."""
        uow1 = MagicMock(spec=AbstractUnitOfWork)
        uow1.activities = mock_activity_repo
        uow1.__enter__.return_value = uow1

        uow2 = MagicMock(spec=AbstractUnitOfWork)
        uow2.activities = mock_activity_repo
        uow2.__enter__.return_value = uow2

        factory = MagicMock(side_effect=[uow1, uow2])

        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=factory,
            batch_size=2,
        )
        mock_strava_reader.read_activities_by_year.return_value = make_activities(3)

        service.backfill_user("12345", years=[2024])

        assert factory.call_count == 2  # 3 activities / batch_size 2 = 2 batches


# =============================================================================
# Tests: PostgreSQL Geography Reconciliation
# =============================================================================


class TestPostgresGeographyReconciliation:
    """Tests for missing-route insertion and region-tag reconciliation."""

    def test_inserts_summary_route_and_tags_activity(
        self,
        service: BackfillService,
        mock_activity_repo,
    ):
        """Summary list geometry fills a missing route before region tagging."""
        mock_activity_repo.insert_route.return_value = True

        stats = service._insert_to_postgres([make_summary_activity()])

        assert stats == PostgresWriteStats(inserted=1)
        mock_activity_repo.insert_route.assert_called_once()
        activity_id, geojson = mock_activity_repo.insert_route.call_args.args
        assert activity_id == 12345
        assert json.loads(geojson)["type"] == "LineString"
        mock_activity_repo.tag_activity_regions.assert_called_once_with(12345)
        mock_activity_repo.clear_activity_regions.assert_not_called()

    def test_prefers_detailed_polyline_over_summary(
        self,
        service: BackfillService,
        mock_activity_repo,
    ):
        """A normalized detailed polyline wins when both route forms exist."""
        standard = make_standard_activity(
            polyline="detailed-route",
            summary_polyline="summary-route",
        )

        with (
            patch(
                "stravapipe.application.backfill.service.StandardActivity.model_validate",
                return_value=standard,
            ),
            patch(
                "stravapipe.application.backfill.service.decode_polyline_to_geojson",
                return_value='{"type":"LineString","coordinates":[]}',
            ) as mock_decode,
        ):
            service._insert_to_postgres([make_summary_activity()])

        mock_decode.assert_called_once_with("detailed-route")
        mock_activity_repo.insert_route.assert_called_once_with(
            12345,
            '{"type":"LineString","coordinates":[]}',
        )
        mock_activity_repo.tag_activity_regions.assert_called_once_with(12345)

    def test_route_conflict_preserves_stored_route_and_retags(
        self,
        service: BackfillService,
        mock_activity_repo,
    ):
        """An existing route is not overwritten, but its tags are reconciled."""
        mock_activity_repo.insert_route.return_value = False

        stats = service._insert_to_postgres([make_summary_activity()])

        assert stats == PostgresWriteStats(inserted=1)
        mock_activity_repo.insert_route.assert_called_once()
        mock_activity_repo.tag_activity_regions.assert_called_once_with(12345)

    def test_invalid_non_empty_polyline_logs_and_retags_stored_route(
        self,
        service: BackfillService,
        mock_activity_repo,
        caplog,
    ):
        """Invalid incoming geometry cannot prevent repair of existing tags."""
        with (
            patch(
                "stravapipe.application.backfill.service.decode_polyline_to_geojson",
                return_value=None,
            ),
            caplog.at_level(
                "WARNING",
                logger="stravapipe.application.backfill.service",
            ),
        ):
            stats = service._insert_to_postgres(
                [make_summary_activity(summary_polyline="invalid")]
            )

        assert stats == PostgresWriteStats(inserted=1)
        mock_activity_repo.insert_route.assert_not_called()
        mock_activity_repo.tag_activity_regions.assert_called_once_with(12345)
        assert any(
            record.getMessage()
            == "Activity 12345 has a polyline but decoded to no geometry; "
            "route insertion skipped before region reconciliation"
            for record in caplog.records
        )

    def test_empty_polyline_still_retags_stored_route(
        self,
        service: BackfillService,
        mock_activity_repo,
    ):
        """An empty list-endpoint route still triggers stored-route tagging."""
        with patch(
            "stravapipe.application.backfill.service.decode_polyline_to_geojson"
        ) as mock_decode:
            service._insert_to_postgres([make_summary_activity(summary_polyline="")])

        mock_decode.assert_not_called()
        mock_activity_repo.insert_route.assert_not_called()
        mock_activity_repo.tag_activity_regions.assert_called_once_with(12345)

    def test_missing_map_still_retags_stored_route(
        self,
        service: BackfillService,
        mock_activity_repo,
    ):
        """A normalized activity without a map reconciles any stored route."""
        standard = make_standard_activity(include_map=False)

        with (
            patch(
                "stravapipe.application.backfill.service.StandardActivity.model_validate",
                return_value=standard,
            ),
            patch(
                "stravapipe.application.backfill.service.decode_polyline_to_geojson"
            ) as mock_decode,
        ):
            service._insert_to_postgres([make_summary_activity()])

        mock_decode.assert_not_called()
        mock_activity_repo.insert_route.assert_not_called()
        mock_activity_repo.tag_activity_regions.assert_called_once_with(12345)

    @pytest.mark.parametrize(
        ("type_", "sport_type", "trainer", "manual"),
        [
            ("Run", "Run", True, False),
            ("Run", "Run", False, True),
            ("Ride", "VirtualRide", False, False),
            ("VirtualRun", "Run", False, False),
        ],
    )
    def test_non_geographic_activity_clears_tags_and_skips_route_work(
        self,
        service: BackfillService,
        mock_activity_repo,
        type_: str,
        sport_type: str,
        trainer: bool,
        manual: bool,
    ):
        """Every non-geographic class preserves its route and clears only tags."""
        activity = make_summary_activity(
            type_=type_,
            sport_type=sport_type,
            trainer=trainer,
            manual=manual,
        )

        with patch(
            "stravapipe.application.backfill.service.decode_polyline_to_geojson"
        ) as mock_decode:
            stats = service._insert_to_postgres([activity])

        assert stats == PostgresWriteStats(inserted=1)
        mock_activity_repo.clear_activity_regions.assert_called_once_with(12345)
        mock_decode.assert_not_called()
        mock_activity_repo.insert_route.assert_not_called()
        mock_activity_repo.tag_activity_regions.assert_not_called()

    @pytest.mark.parametrize(
        ("failing_operation", "manual"),
        [
            ("insert_route", False),
            ("tag_activity_regions", False),
            ("clear_activity_regions", True),
        ],
    )
    def test_geography_failure_rolls_back_and_fails_whole_batch(
        self,
        service: BackfillService,
        mock_activity_repo,
        mock_uow,
        failing_operation: str,
        manual: bool,
    ):
        """Route and tag failures share the activity batch transaction."""
        getattr(mock_activity_repo, failing_operation).side_effect = RuntimeError(
            f"{failing_operation} failed"
        )
        activity = make_summary_activity(manual=manual)

        stats = service._insert_to_postgres([activity])

        assert stats == PostgresWriteStats(errors=1)
        mock_uow.commit.assert_not_called()


# =============================================================================
# Tests: BigQuery Insertion
# =============================================================================


class TestBigQueryInsertion:
    """Tests for BigQuery batch insertion logic."""

    def test_skips_bq_when_no_writer(
        self,
        service: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
    ):
        """No BQ writes when bq_writer is None."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities

        result = service.backfill_user("12345", years=[2024])

        assert result.total_bq_inserted == 0

    def test_writes_to_bq_when_configured(
        self,
        service_with_bq: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
        mock_bq_writer,
    ):
        """BQ writes happen when writer is configured."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities
        mock_bq_writer.write_activities_batch.return_value = {
            "rows_affected": 3,
            "execution_time_ms": 100,
            "job_id": "test",
            "query_preview": "",
        }

        result = service_with_bq.backfill_user("12345", years=[2024])

        mock_bq_writer.write_activities_batch.assert_called_once()
        assert result.total_bq_inserted == 3

    def test_bq_error_tracked(
        self,
        service_with_bq: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
        mock_bq_writer,
    ):
        """BQ errors are tracked without stopping PG writes."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities
        mock_bq_writer.write_activities_batch.side_effect = RuntimeError("BQ error")

        result = service_with_bq.backfill_user("12345", years=[2024])

        # PG should still succeed
        assert result.total_pg_inserted == 3
        # BQ should report errors
        assert result.year_stats[0].bq_errors == 3
        assert result.success is False


# =============================================================================
# Tests: BigQuery Transient-Error Retry
# =============================================================================


class TestBigQueryRetry:
    """Tests for the in-batch retry around `write_activities_batch`.

    `time.sleep` is patched in every test so the exponential backoff
    doesn't slow the suite — the call list is asserted to verify the
    intended backoff schedule.
    """

    @pytest.mark.parametrize(
        "exc",
        [
            gapi_exceptions.ServiceUnavailable("503"),
            gapi_exceptions.DeadlineExceeded("504"),
            gapi_exceptions.RetryError("retry-error", cause=RuntimeError()),
            TimeoutError("local-timeout"),
        ],
        ids=["ServiceUnavailable", "DeadlineExceeded", "RetryError", "TimeoutError"],
    )
    def test_transient_then_success_no_error(
        self,
        service_with_bq: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
        mock_bq_writer,
        caplog,
        exc: BaseException,
    ):
        """Each retryable exception class: 2 failures then success → no error."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities
        mock_bq_writer.write_activities_batch.side_effect = [
            exc,
            exc,
            {
                "rows_affected": 3,
                "execution_time_ms": 100,
                "job_id": "test",
                "query_preview": "",
            },
        ]

        with (
            patch("stravapipe.application.backfill.service.time.sleep") as mock_sleep,
            caplog.at_level(
                "WARNING", logger="stravapipe.application.backfill.service"
            ),
        ):
            result = service_with_bq.backfill_user("12345", years=[2024])

        assert mock_bq_writer.write_activities_batch.call_count == 3
        assert mock_sleep.call_args_list == [call(1), call(2)]
        assert result.year_stats[0].bq_inserted == 3
        assert result.year_stats[0].bq_errors == 0
        assert result.success is True

        retry_warnings = [
            r for r in caplog.records if "transient failure" in r.getMessage()
        ]
        assert len(retry_warnings) == 2

    def test_exhausts_retries_counts_batch_errored_once(
        self,
        service_with_bq: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
        mock_bq_writer,
    ):
        """Three transient failures: batch errored once; no 4th attempt."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities
        mock_bq_writer.write_activities_batch.side_effect = (
            gapi_exceptions.ServiceUnavailable("503")
        )

        with patch("stravapipe.application.backfill.service.time.sleep"):
            result = service_with_bq.backfill_user("12345", years=[2024])

        # Exactly 3 attempts — no 4th try after the cap.
        assert mock_bq_writer.write_activities_batch.call_count == 3
        # PG still succeeds; BQ counts the batch (3 activities) as errored once.
        assert result.total_pg_inserted == 3
        assert result.year_stats[0].bq_errors == 3
        assert result.success is False

    def test_non_retryable_surfaces_immediately(
        self,
        service_with_bq: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
        mock_bq_writer,
    ):
        """InvalidArgument (schema drift) is not retried — fail once."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities
        mock_bq_writer.write_activities_batch.side_effect = (
            gapi_exceptions.InvalidArgument("schema mismatch")
        )

        with patch("stravapipe.application.backfill.service.time.sleep") as mock_sleep:
            result = service_with_bq.backfill_user("12345", years=[2024])

        # Exactly one attempt — InvalidArgument bypasses the retry loop.
        assert mock_bq_writer.write_activities_batch.call_count == 1
        mock_sleep.assert_not_called()
        assert result.year_stats[0].bq_errors == 3
        assert result.success is False


# =============================================================================
# Tests: Metric Logging
# =============================================================================


class TestMetricLogging:
    """Tests for the exact batch, year, and terminal metric contract."""

    def test_logs_postgres_batch_metrics(
        self,
        service: BackfillService,
        mock_activity_repo,
        caplog,
    ):
        """A committed batch logs inserted, updated, and error counts."""
        mock_activity_repo.get_existing_ids.return_value = {2, 3}

        with caplog.at_level("INFO", logger="stravapipe.application.backfill.service"):
            stats = service._insert_to_postgres(make_activities(3))

        assert stats == PostgresWriteStats(inserted=1, updated=2, errors=0)
        assert [
            record.getMessage()
            for record in caplog.records
            if record.getMessage().startswith("PG batch")
        ] == ["PG batch 1/1: 1 inserted, 2 updated, 0 errors"]

    def test_logs_year_metrics(
        self,
        service: BackfillService,
        mock_strava_reader,
        caplog,
    ):
        """The year summary reports the same PostgreSQL metric contract."""
        mock_strava_reader.read_activities_by_year.return_value = make_activities(3)

        with (
            patch.object(
                service,
                "_insert_to_postgres",
                return_value=PostgresWriteStats(inserted=2, updated=1),
            ),
            patch(
                "stravapipe.application.backfill.service.time.monotonic",
                side_effect=[10.0, 12.0],
            ),
            caplog.at_level("INFO", logger="stravapipe.application.backfill.service"),
        ):
            service._backfill_year(2024)

        assert [
            record.getMessage()
            for record in caplog.records
            if record.getMessage().startswith("Year 2024 complete")
        ] == [
            "Year 2024 complete in 2.0s: "
            "PG(2 inserted, 1 updated, 0 errors), BQ(0 inserted, 0 errors)"
        ]

    @pytest.mark.parametrize(
        ("pg_errors", "level", "prefix"),
        [
            (0, "INFO", "Backfill completed for athlete"),
            (1, "WARNING", "Backfill completed with errors for athlete"),
        ],
    )
    def test_logs_terminal_metrics(
        self,
        service: BackfillService,
        caplog,
        pg_errors: int,
        level: str,
        prefix: str,
    ):
        """Success and failure summaries expose the same terminal fields."""
        stats = YearStats(
            year=2024,
            activities_found=4,
            pg_inserted=2,
            pg_updated=1,
            pg_errors=pg_errors,
            bq_inserted=4,
        )

        with (
            patch.object(service, "_backfill_year", return_value=stats),
            patch(
                "stravapipe.application.backfill.service.time.monotonic",
                side_effect=[10.0, 15.0],
            ),
            caplog.at_level(level, logger="stravapipe.application.backfill.service"),
        ):
            service.backfill_user("12345", years=[2024])

        terminal = [
            record.getMessage()
            for record in caplog.records
            if record.getMessage().startswith(prefix)
        ]
        if pg_errors == 0:
            assert terminal == [
                "Backfill completed for athlete 12345: 4 activities across 1 year "
                "(PG: 2 inserted, 1 updated; "
                "BQ: 4 inserted; errors: 0) in 5.0s"
            ]
        else:
            assert terminal == [
                "Backfill completed with errors for athlete 12345: 4 activities "
                "across 1 year (PG: 2 inserted, 1 updated; "
                "BQ: 4 inserted; errors: 1) in 5.0s"
            ]


# =============================================================================
# Tests: Progress Reporting
# =============================================================================


class TestProgressReporting:
    """Tests for progress reporter integration."""

    def test_reports_started(
        self,
        mock_strava_reader,
        mock_uow_factory,
        mock_progress,
    ):
        """Progress reporter is notified when backfill starts."""
        mock_strava_reader.read_activities_by_year.return_value = []
        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
            progress_reporter=mock_progress,
        )

        service.backfill_user("12345", years=[2024])

        mock_progress.report_started.assert_called_once_with("12345", [2024])

    def test_reports_year_complete(
        self,
        mock_strava_reader,
        mock_uow_factory,
        mock_activity_repo,
        mock_progress,
    ):
        """Progress reporter is notified after each year completes."""
        mock_strava_reader.read_activities_by_year.side_effect = [
            make_activities(5, year=2023),
            make_activities(3, year=2024),
        ]

        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
            progress_reporter=mock_progress,
        )

        result = service.backfill_user("12345", years=[2023, 2024])

        assert mock_progress.report_year_complete.call_args_list == [
            call("12345", result.year_stats[0]),
            call("12345", result.year_stats[1]),
        ]
        assert [stats.activities_found for stats in result.year_stats] == [5, 3]

    def test_reporter_failure_does_not_corrupt_successful_year(
        self,
        mock_strava_reader,
        mock_uow_factory,
        mock_activity_repo,
        mock_progress,
        caplog,
    ):
        """A control-plane failure cannot duplicate or fail committed data stats."""
        mock_strava_reader.read_activities_by_year.return_value = make_activities(2)
        mock_activity_repo.get_existing_ids.return_value = {2}
        mock_progress.report_year_complete.side_effect = RuntimeError(
            "progress unavailable"
        )
        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
            progress_reporter=mock_progress,
        )

        with caplog.at_level("ERROR", logger="stravapipe.application.backfill.service"):
            result = service.backfill_user("12345", years=[2024])

        assert result.success is True
        assert len(result.year_stats) == 1
        assert result.total_pg_inserted == 1
        assert result.total_pg_updated == 1
        mock_progress.report_completed.assert_called_once_with("12345", result)
        assert any(
            record.getMessage()
            == "Progress reporter failed during year_complete for athlete 12345"
            for record in caplog.records
        )

    def test_reporter_mutation_cannot_change_backfill_state(
        self,
        mock_strava_reader,
        mock_uow_factory,
        mock_progress,
    ):
        """Reporter payloads are snapshots, even when mutation precedes failure."""

        def mutate_started(_athlete_id: str, reported_years: list[int]) -> None:
            reported_years.clear()
            raise RuntimeError("progress unavailable")

        def mutate_year(_athlete_id: str, stats: YearStats) -> None:
            stats.activities_found = 999
            stats.pg_inserted = 999
            raise RuntimeError("progress unavailable")

        def mutate_completed(_athlete_id: str, result: BackfillResult) -> None:
            result.years.clear()
            result.year_stats.clear()
            result.total_activities = 999
            result.total_pg_inserted = 999
            result.total_errors = 999
            raise RuntimeError("progress unavailable")

        mock_strava_reader.read_activities_by_year.side_effect = [
            make_activities(2, year=2023),
            make_activities(1, year=2024),
        ]
        mock_progress.report_started.side_effect = mutate_started
        mock_progress.report_year_complete.side_effect = mutate_year
        mock_progress.report_completed.side_effect = mutate_completed
        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
            progress_reporter=mock_progress,
        )

        result = service.backfill_user("12345", years=[2024, 2023])

        assert result.years == [2023, 2024]
        assert [stats.activities_found for stats in result.year_stats] == [2, 1]
        assert [stats.pg_inserted for stats in result.year_stats] == [2, 1]
        assert result.total_activities == 3
        assert result.total_pg_inserted == 3
        assert result.total_errors == 0
        assert result.success is True
        assert mock_strava_reader.read_activities_by_year.call_args_list == [
            call(2023),
            call(2024),
        ]

    def test_reports_completed_on_success(
        self,
        mock_strava_reader,
        mock_uow_factory,
        mock_progress,
    ):
        """Progress reporter gets completed callback on success."""
        mock_strava_reader.read_activities_by_year.return_value = []
        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
            progress_reporter=mock_progress,
        )

        service.backfill_user("12345", years=[2024])

        mock_progress.report_completed.assert_called_once()
        mock_progress.report_failed.assert_not_called()

    def test_reports_failed_on_errors(
        self,
        mock_strava_reader,
        mock_uow_factory,
        mock_uow,
        mock_progress,
    ):
        """Progress reporter gets failed callback on errors."""
        mock_strava_reader.read_activities_by_year.return_value = make_activities(1)
        mock_uow.__enter__.side_effect = RuntimeError("db down")
        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
            progress_reporter=mock_progress,
        )

        service.backfill_user("12345", years=[2024])

        mock_progress.report_failed.assert_called_once()
        mock_progress.report_completed.assert_not_called()

    def test_noop_reporter_is_default(self):
        """NoOpProgressReporter is used when none is provided."""
        reader = create_autospec(ReadDetailedActivities, instance=True)
        reader.read_activities_by_year.return_value = []
        service = BackfillService(
            strava_reader=reader,
            uow_factory=MagicMock(return_value=MagicMock(spec=AbstractUnitOfWork)),
        )
        # Should not raise — uses NoOpProgressReporter
        result = service.backfill_user("12345", years=[2024])
        assert result.success is True


# =============================================================================
# Tests: Error Resilience
# =============================================================================


class TestErrorResilience:
    """Tests for error handling across years."""

    def test_continues_after_year_failure(
        self,
        mock_strava_reader,
        mock_uow_factory,
        mock_activity_repo,
    ):
        """A failed year doesn't stop subsequent years."""
        mock_strava_reader.read_activities_by_year.side_effect = [
            RuntimeError("Strava API down"),  # 2023 fails
            make_activities(3, year=2024),  # 2024 succeeds
        ]
        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
        )

        result = service.backfill_user("12345", years=[2023, 2024])

        assert result.total_errors == 1  # 2023 error
        assert result.total_pg_inserted == 3  # 2024 succeeded
        assert len(result.year_stats) == 2
        assert result.success is False


# =============================================================================
# Tests: BackfillResult
# =============================================================================


class TestBackfillResult:
    """Tests for BackfillResult dataclass."""

    def test_success_when_no_errors(self):
        """Result is successful when total_errors is 0."""
        result = BackfillResult(athlete_id="123", total_errors=0)
        assert result.success is True

    def test_not_success_when_errors(self):
        """Result is not successful when there are errors."""
        result = BackfillResult(athlete_id="123", total_errors=1)
        assert result.success is False
