"""Unit tests for BackfillService.

Tests the bulk backfill orchestration logic using mocked adapters.
Follows the same patterns as test_write_service.py:
- unittest.mock with spec= for interface compliance
- Arrange/Act/Assert structure
- Grouped by behavior
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock, call, create_autospec

import pytest

from stravapipe.adapters.gcp import ActivitiesWriter
from stravapipe.application.backfill.service import (
    BackfillService,
    ProgressReporter,
)
from stravapipe.domain.activity import MetaAthlete, SummaryMap, SummaryStravaActivity
from stravapipe.ports.out.postgres import ActivityRepository
from stravapipe.ports.out.read import ReadDetailedActivities
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork

# =============================================================================
# Test Fixtures
# =============================================================================


def make_summary_activity(
    activity_id: int = 12345,
    user_id: int = 999,
    name: str = "Morning Run",
    sport_type: str = "Run",
    year: int = 2024,
) -> SummaryStravaActivity:
    """Factory for creating test SummaryStravaActivity objects."""
    return SummaryStravaActivity(
        id=activity_id,
        resource_state=2,
        athlete=MetaAthlete(id=user_id, resource_state=1),
        name=name,
        type="Run",
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
        map=SummaryMap(id=f"a{activity_id}", summary_polyline="abc", resource_state=2),
        trainer=False,
        commute=False,
        manual=False,
        private=False,
        flagged=False,
        average_speed=2.78,
        max_speed=3.5,
    )


def make_activities(count: int, year: int = 2024) -> list[SummaryStravaActivity]:
    """Create a list of test activities."""
    return [make_summary_activity(activity_id=i + 1, year=year) for i in range(count)]


@pytest.fixture
def mock_activity_repo():
    """Mock activity repository with spec for interface compliance."""
    return create_autospec(ActivityRepository, instance=True)


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
        mock_activity_repo.insert.return_value = True

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
        mock_activity_repo.insert.return_value = True

        result = service.backfill_user("12345", years=[2025, 2023, 2024])

        assert result.years == [2023, 2024, 2025]
        assert mock_strava_reader.read_activities_by_year.call_args_list == [
            call(2023),
            call(2024),
            call(2025),
        ]
        assert result.total_activities == 6  # 2 per year * 3 years

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

    def test_records_duration(
        self,
        service: BackfillService,
        mock_strava_reader,
    ):
        """Result includes timing information."""
        mock_strava_reader.read_activities_by_year.return_value = []

        result = service.backfill_user("12345", years=[2024])

        assert result.duration_seconds >= 0


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
        mock_activity_repo.insert.return_value = True

        result = service.backfill_user("12345", years=[2024])

        # 5 activities / batch_size 2 = 3 batches
        assert mock_uow_factory.call_count == 3
        assert mock_uow.commit.call_count == 3
        assert result.total_pg_inserted == 5

    def test_tracks_duplicates_as_skipped(
        self,
        service: BackfillService,
        mock_strava_reader,
        mock_activity_repo,
    ):
        """Duplicate activities (insert returns False) are tracked as skipped."""
        activities = make_activities(3, year=2024)
        mock_strava_reader.read_activities_by_year.return_value = activities
        # First insert succeeds, second and third are duplicates
        mock_activity_repo.insert.side_effect = [True, False, False]

        result = service.backfill_user("12345", years=[2024])

        assert result.total_pg_inserted == 1
        assert result.year_stats[0].pg_skipped == 2
        assert result.success is True  # Duplicates are not errors

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
        mock_activity_repo.insert.return_value = True

        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=factory,
            batch_size=2,
        )
        mock_strava_reader.read_activities_by_year.return_value = make_activities(3)

        service.backfill_user("12345", years=[2024])

        assert factory.call_count == 2  # 3 activities / batch_size 2 = 2 batches


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
        mock_activity_repo.insert.return_value = True

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
        mock_activity_repo.insert.return_value = True
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
        mock_activity_repo.insert.return_value = True
        mock_bq_writer.write_activities_batch.side_effect = RuntimeError("BQ error")

        result = service_with_bq.backfill_user("12345", years=[2024])

        # PG should still succeed
        assert result.total_pg_inserted == 3
        # BQ should report errors
        assert result.year_stats[0].bq_errors == 3
        assert result.success is False


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
        mock_activity_repo.insert.return_value = True

        service = BackfillService(
            strava_reader=mock_strava_reader,
            uow_factory=mock_uow_factory,
            progress_reporter=mock_progress,
        )

        service.backfill_user("12345", years=[2023, 2024])

        assert mock_progress.report_year_complete.call_args_list == [
            call("12345", 2023, 5),
            call("12345", 2024, 3),
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
        mock_activity_repo.insert.return_value = True
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
        from stravapipe.application.backfill.service import BackfillResult

        result = BackfillResult(athlete_id="123", total_errors=0)
        assert result.success is True

    def test_not_success_when_errors(self):
        """Result is not successful when there are errors."""
        from stravapipe.application.backfill.service import BackfillResult

        result = BackfillResult(athlete_id="123", total_errors=1)
        assert result.success is False
