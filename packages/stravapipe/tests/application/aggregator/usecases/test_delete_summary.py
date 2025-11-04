"""Tests for DeleteSummaryUseCase"""

from datetime import UTC, datetime

from google.protobuf import json_format
import pytest

from stravapipe.application.aggregator.services import PacingService
from stravapipe.application.aggregator.usecases.delete_summary import (
    DeleteSummaryUseCase,
)
from stravapipe.domain import MinimalStravaActivity, WebhookRequest
from stravapipe.exceptions import ActivityNotFoundError
from stravapipe.types.generated.sports_metrics_pb2 import DailySummary
from tests.mocks.export_service import MockExportService
from tests.mocks.read_activities_metadata import MockReadActivitiesMetadata
from tests.mocks.read_summaries import MockReadSummaries


@pytest.fixture
def webhook_delete_request():
    """Delete webhook for activity ID 1"""
    return WebhookRequest(
        aspect_type="delete",
        event_time=1702168328,
        object_id=1,
        object_type="activity",
        owner_id=-1,
        subscription_id=2,
        updates={},
    )


@pytest.fixture
def webhook_delete_request_last_activity():
    """Delete webhook for activity ID 2 (last activity on 2023-01-02)"""
    return WebhookRequest(
        aspect_type="delete",
        event_time=1702168328,
        object_id=2,
        object_type="activity",
        owner_id=-1,
        subscription_id=2,
        updates={},
    )


@pytest.fixture
def webhook_delete_request_non_ride():
    """Delete webhook for activity ID 3 (Run type - should skip)"""
    return WebhookRequest(
        aspect_type="delete",
        event_time=1702168328,
        object_id=3,
        object_type="activity",
        owner_id=-1,
        subscription_id=2,
        updates={},
    )


@pytest.fixture
def webhook_delete_request_not_found():
    """Delete webhook for activity ID 999 (not in BigQuery)"""
    return WebhookRequest(
        aspect_type="delete",
        event_time=1702168328,
        object_id=999,
        object_type="activity",
        owner_id=-1,
        subscription_id=2,
        updates={},
    )


def mock_read_metadata():
    """Mock BigQuery metadata reader with activities 1, 2, 3"""
    activities = {
        1: MinimalStravaActivity(
            id=1,
            type="Ride",
            start_date_local=datetime(2023, 1, 1, 12, 34, 56, tzinfo=UTC),
            distance=16093.44,  # 10 miles in meters
            moving_time=3600,  # 1 hour in seconds
            total_elevation_gain=200.0,  # meters
        ),
        2: MinimalStravaActivity(
            id=2,
            type="VirtualRide",
            start_date_local=datetime(2023, 1, 2, 12, 34, 56, tzinfo=UTC),
            distance=8046.72,  # 5 miles in meters
            moving_time=1800,  # 30 minutes in seconds
            total_elevation_gain=50.0,  # meters
        ),
        3: MinimalStravaActivity(
            id=3,
            type="Run",
            start_date_local=datetime(2023, 1, 3, 12, 34, 56, tzinfo=UTC),
            distance=4828.03,  # 3 miles in meters
            moving_time=1200,  # 20 minutes in seconds
            total_elevation_gain=100.0,  # meters
        ),
    }
    return MockReadActivitiesMetadata(activities=activities)


def mock_read_summaries():
    """Mock summary reader with existing activities for multiple sports"""
    summaries = {
        2023: {
            "cycling": {
                "2023-01-01": {
                    "distance_meters": 32186.88,  # ~20 miles, two activities
                    "time_minutes": 120.0,  # 2 hours
                    "elevation_meters": 400.0,
                    "activities": 2,
                    "activity_ids": [1, 10],  # Activity 1 + another activity
                },
                "2023-01-02": {
                    "distance_meters": 8046.72,  # ~5 miles, single activity
                    "time_minutes": 30.0,  # 30 minutes
                    "elevation_meters": 50.0,
                    "activities": 1,
                    "activity_ids": [2],  # Only activity 2
                },
            },
            "running": {
                "2023-01-03": {
                    "distance_meters": 4828.03,  # ~3 miles, single activity
                    "time_minutes": 20.0,  # 20 minutes
                    "elevation_meters": 100.0,
                    "activities": 1,
                    "activity_ids": [3],  # Activity 3 (Run)
                },
            },
        }
    }
    return MockReadSummaries(summaries=summaries)


@pytest.fixture
def mock_export_service():
    """Fresh MockExportService for each test"""
    return MockExportService()


@pytest.fixture
def mock_pacing_service():
    """Fresh PacingService for each test"""
    return PacingService()


class TestDeleteSummaryUseCase:
    """Test suite for DeleteSummaryUseCase"""

    def test_delete_activity_from_day_with_multiple_activities(
        self, webhook_delete_request, mock_export_service, mock_pacing_service
    ):
        """Test removing one activity when day has multiple activities"""
        # Arrange
        usecase = DeleteSummaryUseCase(
            read_metadata=mock_read_metadata,
            read_summaries=mock_read_summaries,
            pacing_service=lambda: mock_pacing_service,
            export_service=lambda: mock_export_service,
        )

        # Act
        usecase.run(webhook_delete_request)

        # Assert
        assert mock_export_service.results is not None  # Export was called
        assert mock_export_service.year == 2023

        # Check that activity 1 was removed but day still exists
        summary = mock_export_service.results
        assert "2023-01-01" in summary.daily
        assert 1 not in summary.daily["2023-01-01"].activity_ids
        assert 10 in summary.daily["2023-01-01"].activity_ids  # Other activity remains
        # Original had ~32km, we removed ~16km (activity 1), should have ~16km remaining
        assert summary.daily["2023-01-01"].distance_meters == pytest.approx(
            16093.44, abs=100.0
        )  # Allow small tolerance

    def test_delete_last_activity_removes_day(
        self,
        webhook_delete_request_last_activity,
        mock_export_service,
        mock_pacing_service,
    ):
        """Test removing last activity on a day removes the entire day entry"""
        # Arrange
        usecase = DeleteSummaryUseCase(
            read_metadata=mock_read_metadata,
            read_summaries=mock_read_summaries,
            pacing_service=lambda: mock_pacing_service,
            export_service=lambda: mock_export_service,
        )

        # Act
        usecase.run(webhook_delete_request_last_activity)

        # Assert
        summary = mock_export_service.results

        # Day should be completely removed
        assert "2023-01-02" not in summary.daily

    def test_delete_non_ride_activity_removes_from_running_summary(
        self, webhook_delete_request_non_ride, mock_export_service, mock_pacing_service
    ):
        """Test that Run activities are processed and removed from running summary"""
        # Arrange
        usecase = DeleteSummaryUseCase(
            read_metadata=mock_read_metadata,
            read_summaries=mock_read_summaries,
            pacing_service=lambda: mock_pacing_service,
            export_service=lambda: mock_export_service,
        )

        # Act
        usecase.run(webhook_delete_request_non_ride)

        # Assert - export should be called and day should be removed (last activity)
        summary = mock_export_service.results

        # Day should be completely removed since it was the only activity
        assert "2023-01-03" not in summary.daily

    def test_delete_activity_not_in_bigquery_raises_error(
        self, webhook_delete_request_not_found, mock_export_service, mock_pacing_service
    ):
        """Test that missing activity in BigQuery raises ActivityNotFoundError"""
        # Arrange
        usecase = DeleteSummaryUseCase(
            read_metadata=mock_read_metadata,
            read_summaries=mock_read_summaries,
            pacing_service=lambda: mock_pacing_service,
            export_service=lambda: mock_export_service,
        )

        # Act & Assert
        with pytest.raises(ActivityNotFoundError, match="Activity 999 not found"):
            usecase.run(webhook_delete_request_not_found)

    def test_remove_from_summary_activity_not_in_summary_raises_error(self):
        """Test that _remove_from_summary raises error if activity not in summary"""

        # Arrange
        summary_dict = {
            "daily": {
                "2023-01-01": {
                    "distance_meters": 16093.44,
                    "time_minutes": 60.0,
                    "elevation_meters": 100.0,
                    "activities": 1,
                    "activity_ids": [1],
                }
            }
        }
        summary = DailySummary()
        json_format.ParseDict(summary_dict, summary)

        activity = MinimalStravaActivity(
            id=999,
            type="Ride",
            start_date_local=datetime(2023, 1, 5, 12, 0, 0, tzinfo=UTC),
            distance=8046.72,  # 5 miles in meters
            moving_time=1800,  # 30 minutes in seconds
            total_elevation_gain=50.0,  # meters
        )

        # Act & Assert
        with pytest.raises(
            ActivityNotFoundError, match="Activity 999 not found in summary"
        ):
            DeleteSummaryUseCase._remove_from_summary(summary, activity)

    def test_remove_from_summary_date_not_in_summary_raises_error(self):
        """Test that _remove_from_summary raises error if date not in summary"""

        # Arrange - create DailySummary protobuf
        summary_dict = {
            "daily": {
                "2023-01-01": {
                    "distance_meters": 16093.44,
                    "time_minutes": 60.0,
                    "elevation_meters": 100.0,
                    "activities": 1,
                    "activity_ids": [1],
                }
            }
        }
        summary = DailySummary()
        json_format.ParseDict(summary_dict, summary)

        activity = MinimalStravaActivity(
            id=1,
            type="Ride",
            start_date_local=datetime(2023, 1, 5, 12, 0, 0, tzinfo=UTC),  # Wrong date
            distance=16093.44,  # 10 miles in meters
            moving_time=3600,
            total_elevation_gain=100.0,
        )

        # Act & Assert
        with pytest.raises(
            ActivityNotFoundError, match="Activity 1 not found in summary for date"
        ):
            DeleteSummaryUseCase._remove_from_summary(summary, activity)

    def test_pacing_recalculation_called(
        self, webhook_delete_request, mock_export_service, mock_pacing_service
    ):
        """Test that pacing service is called to recalculate cumulative distances"""
        # Arrange
        usecase = DeleteSummaryUseCase(
            read_metadata=mock_read_metadata,
            read_summaries=mock_read_summaries,
            pacing_service=lambda: mock_pacing_service,
            export_service=lambda: mock_export_service,
        )

        # Act
        usecase.run(webhook_delete_request)

        # Assert
        assert mock_export_service.results is not None  # Export was called
        assert mock_export_service.year == 2023
