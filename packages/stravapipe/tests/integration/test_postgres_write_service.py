"""Integration tests for PostgresWriteService.

Tests the service layer with real database, mocking only the Strava API.
"""

from datetime import UTC, datetime
from unittest.mock import Mock

from stravapipe.application.postgres_sync.write_service import PostgresWriteService
from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete
from stravapipe.ports.out.read import ReadStandardActivities


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


def make_mock_strava_reader(activity: StandardActivity) -> Mock:
    """Create mock Strava reader (spec'd as ReadStandardActivities) that
    returns the given activity. Typed as Mock so tests can call
    ``.assert_called_once_with()`` on the recorded method.
    """
    mock = Mock(spec=ReadStandardActivities)
    mock.read_standard_activity_by_id.return_value = activity
    return mock


class TestPostgresWriteServiceIntegration:
    """Integration tests for PostgresWriteService with real DB."""

    def test_create_activity_end_to_end(self, uow):
        """create_activity fetches from Strava and persists to DB."""
        activity = make_activity(activity_id=300001)
        mock_reader = make_mock_strava_reader(activity)

        service = PostgresWriteService(uow=uow, strava_reader=mock_reader)
        result = service.create_activity(300001)

        assert result is True
        mock_reader.read_standard_activity_by_id.assert_called_once_with(300001)

        # Verify persisted
        with uow:
            exists = uow.activities.exists(300001)
        assert exists is True

    def test_create_then_update_metadata(self, uow):
        """Full workflow: create activity, then update its title."""
        activity = make_activity(activity_id=300002, name="Morning Run")
        mock_reader = make_mock_strava_reader(activity)

        service = PostgresWriteService(uow=uow, strava_reader=mock_reader)

        # Create
        service.create_activity(300002)

        # Update title
        updated = service.update_activity_metadata(300002, {"title": "Evening Run"})

        assert updated is True

    def test_create_then_delete(self, uow):
        """Full workflow: create activity, then delete it."""
        activity = make_activity(activity_id=300003)
        mock_reader = make_mock_strava_reader(activity)

        service = PostgresWriteService(uow=uow, strava_reader=mock_reader)

        # Create
        service.create_activity(300003)

        # Delete
        deleted = service.delete_activity(300003)

        assert deleted is True

        # Verify gone
        with uow:
            exists = uow.activities.exists(300003)
        assert exists is False

    def test_activity_exists_after_create(self, uow):
        """activity_exists returns True after create."""
        activity = make_activity(activity_id=300004)
        mock_reader = make_mock_strava_reader(activity)

        service = PostgresWriteService(uow=uow, strava_reader=mock_reader)

        # Before create
        assert service.activity_exists(300004) is False

        # After create
        service.create_activity(300004)
        assert service.activity_exists(300004) is True

    def test_duplicate_create_returns_false(self, uow):
        """Second create for same activity returns False."""
        activity = make_activity(activity_id=300005)
        mock_reader = make_mock_strava_reader(activity)

        service = PostgresWriteService(uow=uow, strava_reader=mock_reader)

        result1 = service.create_activity(300005)
        result2 = service.create_activity(300005)

        assert result1 is True
        assert result2 is False

    def test_update_nonexistent_returns_false(self, uow):
        """update_activity_metadata returns False for missing activity."""
        mock_reader = Mock(spec=ReadStandardActivities)

        service = PostgresWriteService(uow=uow, strava_reader=mock_reader)
        result = service.update_activity_metadata(999999, {"title": "New"})

        assert result is False

    def test_delete_nonexistent_returns_false(self, uow):
        """delete_activity returns False for missing activity."""
        mock_reader = Mock(spec=ReadStandardActivities)

        service = PostgresWriteService(uow=uow, strava_reader=mock_reader)
        result = service.delete_activity(999999)

        assert result is False
