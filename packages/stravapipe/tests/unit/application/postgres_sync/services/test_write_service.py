"""Unit tests for PostgresWriteService.

These tests showcase the power of the Unit of Work pattern for testing:
- Complete isolation from database using unittest.mock
- No network calls to Strava API
- Built-in call tracking via mock assertions
- Clean, fast tests that run anywhere

Uses unittest.mock rather than custom fakes to:
- Avoid maintaining fake implementations in sync with real ones
- Leverage battle-tested mocking framework
- Get automatic interface compliance checking with spec=
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock, create_autospec

import pytest

from stravapipe.application.postgres_sync.write_service import PostgresWriteService
from stravapipe.domain import StandardActivity
from stravapipe.domain.activity import MetaAthlete
from stravapipe.ports.out.postgres import ActivityRepository
from stravapipe.ports.out.read import ReadStandardActivities
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork

# =============================================================================
# Test Fixtures
# =============================================================================


def make_activity(
    activity_id: int = 12345,
    user_id: int = 999,
    name: str = "Morning Run",
    activity_type: str = "Run",
    sport_type: str = "Run",
    distance: float = 5000.0,
) -> StandardActivity:
    """Factory for creating test activities."""
    return StandardActivity(
        id=activity_id,
        athlete=MetaAthlete(id=user_id, resource_state=1),
        name=name,
        type=activity_type,
        sport_type=sport_type,
        start_date_local=datetime(2024, 1, 15, 7, 30, 0, tzinfo=UTC),
        distance=distance,
        moving_time=1800,
        elapsed_time=2000,
        total_elevation_gain=50.0,
    )


@pytest.fixture
def mock_activity_repo():
    """Mock activity repository with spec for interface compliance."""
    return create_autospec(ActivityRepository, instance=True)


@pytest.fixture
def mock_strava_reader():
    """Mock Strava reader with spec for interface compliance."""
    return create_autospec(ReadStandardActivities, instance=True)


@pytest.fixture
def mock_uow(mock_activity_repo):
    """Mock Unit of Work with context manager support.

    MagicMock provides __enter__/__exit__ automatically.
    We attach the activity repo mock as the .activities property.
    """
    uow = MagicMock(spec=AbstractUnitOfWork)
    uow.activities = mock_activity_repo
    # Context manager returns self
    uow.__enter__.return_value = uow
    return uow


@pytest.fixture
def service(mock_uow, mock_strava_reader) -> PostgresWriteService:
    """Configured service with mock dependencies."""
    return PostgresWriteService(uow=mock_uow, strava_reader=mock_strava_reader)


# =============================================================================
# Tests: create_activity
# =============================================================================


class TestCreateActivity:
    """Tests for PostgresWriteService.create_activity()."""

    def test_creates_new_activity_successfully(
        self,
        service: PostgresWriteService,
        mock_strava_reader,
        mock_activity_repo,
        mock_uow,
    ):
        """New activity is fetched from Strava and inserted to PostgreSQL."""
        # Arrange
        activity = make_activity(activity_id=123)
        mock_strava_reader.read_standard_activity_by_id.return_value = activity
        mock_activity_repo.insert.return_value = True  # Inserted successfully

        # Act
        result = service.create_activity(123)

        # Assert
        assert result is True
        mock_strava_reader.read_standard_activity_by_id.assert_called_once_with(123)
        mock_activity_repo.insert.assert_called_once_with(activity)
        mock_uow.commit.assert_called_once()

    def test_returns_false_for_duplicate_activity(
        self,
        service: PostgresWriteService,
        mock_strava_reader,
        mock_activity_repo,
        mock_uow,
    ):
        """Duplicate CREATE event logs warning but doesn't fail."""
        # Arrange
        activity = make_activity(activity_id=123)
        mock_strava_reader.read_standard_activity_by_id.return_value = activity
        mock_activity_repo.insert.return_value = False  # Already exists

        # Act
        result = service.create_activity(123)

        # Assert - should return False (not inserted) but not fail
        assert result is False
        mock_strava_reader.read_standard_activity_by_id.assert_called_once_with(123)
        mock_activity_repo.insert.assert_called_once_with(activity)
        mock_uow.commit.assert_called_once()

    def test_fetches_activity_from_strava_api(
        self,
        service: PostgresWriteService,
        mock_strava_reader,
        mock_activity_repo,
    ):
        """Service delegates to Strava reader for activity data."""
        # Arrange
        activity = make_activity(activity_id=456, name="Trail Run")
        mock_strava_reader.read_standard_activity_by_id.return_value = activity
        mock_activity_repo.insert.return_value = True

        # Act
        service.create_activity(456)

        # Assert
        mock_strava_reader.read_standard_activity_by_id.assert_called_once_with(456)


# =============================================================================
# Tests: activity_exists
# =============================================================================


class TestActivityExists:
    """Tests for PostgresWriteService.activity_exists()."""

    def test_returns_true_when_activity_exists(
        self,
        service: PostgresWriteService,
        mock_activity_repo,
    ):
        """Existing activity returns True."""
        # Arrange
        mock_activity_repo.exists.return_value = True

        # Act
        result = service.activity_exists(789)

        # Assert
        assert result is True
        mock_activity_repo.exists.assert_called_once_with(789)

    def test_returns_false_when_activity_missing(
        self,
        service: PostgresWriteService,
        mock_activity_repo,
    ):
        """Missing activity returns False."""
        # Arrange
        mock_activity_repo.exists.return_value = False

        # Act
        result = service.activity_exists(999)

        # Assert
        assert result is False
        mock_activity_repo.exists.assert_called_once_with(999)


# =============================================================================
# Tests: update_activity_metadata
# =============================================================================


class TestUpdateActivityMetadata:
    """Tests for PostgresWriteService.update_activity_metadata()."""

    def test_updates_metadata_successfully(
        self,
        service: PostgresWriteService,
        mock_activity_repo,
        mock_uow,
    ):
        """Existing activity metadata is updated."""
        # Arrange
        mock_activity_repo.update_metadata.return_value = True
        updates = {"title": "Evening Run", "type": "Run"}

        # Act
        result = service.update_activity_metadata(123, updates)

        # Assert
        assert result is True
        mock_activity_repo.update_metadata.assert_called_once_with(123, updates)
        mock_uow.commit.assert_called_once()

    def test_returns_false_when_activity_not_found(
        self,
        service: PostgresWriteService,
        mock_activity_repo,
        mock_uow,
    ):
        """Missing activity returns False without error."""
        # Arrange
        mock_activity_repo.update_metadata.return_value = False
        updates = {"title": "New Title"}

        # Act
        result = service.update_activity_metadata(999, updates)

        # Assert
        assert result is False
        mock_activity_repo.update_metadata.assert_called_once_with(999, updates)
        mock_uow.commit.assert_called_once()

    def test_does_not_call_strava_api(
        self,
        service: PostgresWriteService,
        mock_strava_reader,
        mock_activity_repo,
    ):
        """Metadata update uses webhook data, not Strava API."""
        # Arrange
        mock_activity_repo.update_metadata.return_value = True

        # Act
        service.update_activity_metadata(123, {"title": "New Title"})

        # Assert - Strava API should NOT be called
        mock_strava_reader.read_standard_activity_by_id.assert_not_called()


# =============================================================================
# Tests: delete_activity
# =============================================================================


class TestDeleteActivity:
    """Tests for PostgresWriteService.delete_activity()."""

    def test_deletes_existing_activity(
        self,
        service: PostgresWriteService,
        mock_activity_repo,
        mock_uow,
    ):
        """Existing activity is deleted successfully."""
        # Arrange
        mock_activity_repo.delete.return_value = True

        # Act
        result = service.delete_activity(123)

        # Assert
        assert result is True
        mock_activity_repo.delete.assert_called_once_with(123)
        mock_uow.commit.assert_called_once()

    def test_returns_false_when_activity_not_found(
        self,
        service: PostgresWriteService,
        mock_activity_repo,
        mock_uow,
    ):
        """Missing activity returns False without error."""
        # Arrange
        mock_activity_repo.delete.return_value = False

        # Act
        result = service.delete_activity(999)

        # Assert
        assert result is False
        mock_activity_repo.delete.assert_called_once_with(999)
        mock_uow.commit.assert_called_once()


# =============================================================================
# Tests: Transaction Behavior (showcases Unit of Work power)
# =============================================================================


class TestTransactionBehavior:
    """Tests demonstrating Unit of Work transaction management.

    These tests highlight WHY the Unit of Work pattern is powerful:
    1. Explicit commit control
    2. Context manager usage for transactions
    3. Clear separation of concerns
    """

    def test_commit_is_called_after_successful_operation(
        self,
        service: PostgresWriteService,
        mock_strava_reader,
        mock_activity_repo,
        mock_uow,
    ):
        """Each operation explicitly commits."""
        # Arrange
        mock_strava_reader.read_standard_activity_by_id.return_value = make_activity()
        mock_activity_repo.insert.return_value = True

        # Act
        service.create_activity(1)

        # Assert - commit called once
        mock_uow.commit.assert_called_once()

    def test_multiple_operations_each_commit(
        self,
        service: PostgresWriteService,
        mock_strava_reader,
        mock_activity_repo,
        mock_uow,
    ):
        """Each service method is a separate transaction."""
        # Arrange
        mock_strava_reader.read_standard_activity_by_id.return_value = make_activity(
            activity_id=100
        )
        mock_activity_repo.insert.return_value = True
        mock_activity_repo.update_metadata.return_value = True
        mock_activity_repo.delete.return_value = True

        # Act - multiple operations
        service.create_activity(100)
        service.update_activity_metadata(100, {"title": "Updated"})
        service.delete_activity(100)

        # Assert - each operation commits (3 commits total)
        assert mock_uow.commit.call_count == 3

    def test_context_manager_is_used(
        self,
        service: PostgresWriteService,
        mock_strava_reader,
        mock_activity_repo,
        mock_uow,
    ):
        """Service uses context manager for each transaction."""
        # Arrange
        mock_strava_reader.read_standard_activity_by_id.return_value = make_activity()
        mock_activity_repo.insert.return_value = True

        # Act
        service.create_activity(123)

        # Assert - context manager was entered
        mock_uow.__enter__.assert_called_once()
        mock_uow.__exit__.assert_called_once()


# =============================================================================
# Tests: Dependency Injection
# =============================================================================


class TestDependencyInjection:
    """Tests demonstrating how DI enables isolated testing.

    The key insight: with proper DI, the service doesn't know or care
    whether its dependencies are real or mocked. This is the power
    of programming to interfaces.
    """

    def test_service_accepts_mock_dependencies(self, mock_uow, mock_strava_reader):
        """Service works with any implementation of its interfaces."""
        # This test verifies the service can be constructed with mocks
        service = PostgresWriteService(uow=mock_uow, strava_reader=mock_strava_reader)
        assert service is not None

    def test_repository_accessed_through_uow(
        self,
        mock_strava_reader,
        mock_activity_repo,
    ):
        """Repository is accessed through the Unit of Work, not directly."""
        # Arrange
        mock_uow = MagicMock(spec=AbstractUnitOfWork)
        mock_uow.activities = mock_activity_repo
        mock_uow.__enter__.return_value = mock_uow

        mock_strava_reader.read_standard_activity_by_id.return_value = make_activity()
        mock_activity_repo.insert.return_value = True

        service = PostgresWriteService(uow=mock_uow, strava_reader=mock_strava_reader)

        # Act
        service.create_activity(123)

        # Assert - repo was accessed via UoW
        mock_activity_repo.insert.assert_called_once()
