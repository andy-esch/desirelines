from datetime import UTC, datetime

import pytest

from stravapipe.application.aggregator.services import PacingService
from stravapipe.application.aggregator.usecases.update_summary import UpdateSummaryUseCase
from stravapipe.domain import MinimalStravaActivity, StravaTokenSet, WebhookRequest


@pytest.fixture
def webhook_request_existing():
    return WebhookRequest(
        aspect_type="create",
        event_time=1702168328,
        object_id=1,
        object_type="activity",
        owner_id=-1,
        subscription_id=2,
        updates={},
    )


@pytest.fixture
def webhook_request_new():
    return WebhookRequest(
        aspect_type="create",
        event_time=1702168328,
        object_id=2,
        object_type="activity",
        owner_id=-1,
        subscription_id=2,
        updates={},
    )


@pytest.fixture
def webhook_request_unsupported():
    return WebhookRequest(
        aspect_type="create",
        event_time=1702168328,
        object_id=3,
        object_type="activity",
        owner_id=-1,
        subscription_id=2,
        updates={},
    )


@pytest.fixture
def mock_dependencies(mocker):
    """Reusable mock dependencies for UpdateSummaryUseCase"""
    mocks = {
        "read_strava_token": mocker.Mock(),
        "read_activities": mocker.Mock(),
        "read_summaries": mocker.Mock(),
        "export_service": mocker.Mock(),
        "pacing_service": mocker.Mock(),
    }

    # Set up common return values
    token_set = StravaTokenSet(
        client_id=123, client_secret="foo", access_token="bar", refresh_token="baz"
    )
    mocks["read_strava_token"].return_value.get_token_set.return_value = token_set

    # Default activities data - use MinimalStravaActivity for lightweight aggregator tests
    activities = {
        1: MinimalStravaActivity(
            id=1,
            type="Ride",
            start_date_local=datetime(2023, 1, 1, 12, 34, 56, tzinfo=UTC),
            distance=10 * 1000.0 / 0.62137,  # ~10 miles
        ),
        2: MinimalStravaActivity(
            id=2,
            type="VirtualRide",
            start_date_local=datetime(2023, 1, 2, 12, 34, 56, tzinfo=UTC),
            distance=10 * 1000.0 / 0.62137,  # ~10 miles
        ),
        3: MinimalStravaActivity(
            id=3,
            type="Run",
            start_date_local=datetime(2023, 1, 2, 12, 34, 56, tzinfo=UTC),
            distance=10 * 1000.0 / 0.62137,  # ~10 miles
        ),
    }

    def mock_read_activity_by_id(activity_id):
        return activities.get(activity_id)

    mocks[
        "read_activities"
    ].return_value.read_activity_by_id.side_effect = mock_read_activity_by_id

    # Default summaries data
    summaries = {2023: {"2023-01-01": {"distance_miles": 10, "activity_ids": [1]}}}
    mocks["read_summaries"].return_value.read_activity_summary_by_year.side_effect = (
        lambda year: summaries.get(year)
    )

    # Mock pacing service - return a real instance since it's stateless
    mocks["pacing_service"].return_value = PacingService()

    return mocks


@pytest.fixture
def usecase_with_mocks(mock_dependencies, mock_aggregator_config):
    """UpdateSummaryUseCase with all dependencies mocked"""
    return UpdateSummaryUseCase(
        read_strava_token=mock_dependencies["read_strava_token"],
        read_activities=mock_dependencies["read_activities"],
        read_summaries=mock_dependencies["read_summaries"],
        export_service=mock_dependencies["export_service"],
        pacing_service=mock_dependencies["pacing_service"],
    )


class TestUpdateSummaryUseCaseWithMocks:
    def test_new_activity(
        self, usecase_with_mocks, mock_dependencies, webhook_request_new
    ):
        # Run the usecase
        usecase_with_mocks.run(webhook_request_new)

        # Verify export was called with expected summary
        expected_summary = {
            "2023-01-01": {"distance_miles": 10.0, "activity_ids": [1]},
            "2023-01-02": {"distance_miles": 10.0, "activity_ids": [2]},
        }

        mock_dependencies["export_service"].return_value.export.assert_called_once()
        call_args = mock_dependencies["export_service"].return_value.export.call_args
        assert call_args.kwargs["summary"] == expected_summary

    def test_existing_activity(
        self, usecase_with_mocks, mock_dependencies, webhook_request_existing
    ):
        # Run the usecase
        usecase_with_mocks.run(webhook_request_existing)

        # Verify export was NOT called since activity already exists
        mock_dependencies["export_service"].return_value.export.assert_not_called()

    def test_untracked_activity(
        self, usecase_with_mocks, mock_dependencies, webhook_request_unsupported
    ):
        # Run the usecase
        usecase_with_mocks.run(webhook_request_unsupported)

        # Verify export was NOT called since activity type is not tracked
        mock_dependencies["export_service"].return_value.export.assert_not_called()
