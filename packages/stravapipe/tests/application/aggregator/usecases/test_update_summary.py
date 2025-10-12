from datetime import UTC, datetime
from functools import lru_cache

import pytest

from stravapipe.application.aggregator.services import PacingService
from stravapipe.application.aggregator.usecases.update_summary import (
    UpdateSummaryUseCase,
)
from stravapipe.domain import MinimalStravaActivity, StravaTokenSet, WebhookRequest
from tests.mocks.export_service import MockExportService
from tests.mocks.read_activities import MockReadActivities
from tests.mocks.read_strava_token import MockReadStravaToken
from tests.mocks.read_summaries import MockReadSummaries


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


def mock_read_token():
    return MockReadStravaToken(
        tokenset=StravaTokenSet(
            client_id=123, client_secret="foo", access_token="bar", refresh_token="baz"
        )
    )


def mock_read_activities(tokens: StravaTokenSet):
    # Use MinimalStravaActivity for lightweight aggregator tests
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
    return MockReadActivities(activities=activities)


def mock_read_summaries():
    summaries = {2023: {"2023-01-01": {"distance_miles": 10, "activity_ids": [1]}}}
    return MockReadSummaries(summaries=summaries)


def make_pacing_service() -> PacingService:
    return PacingService()


@lru_cache(maxsize=1)
def mock_export_service():
    return MockExportService()


@pytest.fixture
def usecase(mock_aggregator_config):
    return UpdateSummaryUseCase(
        read_strava_token=mock_read_token,
        read_activities=mock_read_activities,
        read_summaries=mock_read_summaries,
        export_service=mock_export_service,
        pacing_service=make_pacing_service,
    )


class TestUpdateSummaryUseCase:
    def test_new_activity(self, usecase, webhook_request_new):
        usecase.run(webhook_request_new)
        expected = {
            "2023-01-01": {"distance_miles": 10.0, "activity_ids": [1]},
            "2023-01-02": {"distance_miles": 10.0, "activity_ids": [2]},
        }
        assert usecase._export_service.results == expected
        mock_export_service.cache_clear()

    def test_existing_activity(self, usecase, webhook_request_existing):
        usecase.run(webhook_request_existing)
        assert usecase._export_service.results is None, (
            "Summary should not be updated since the activity already exists "
            "in the summary"
        )

    def test_untracked_activity(self, usecase, webhook_request_unsupported):
        usecase.run(webhook_request_unsupported)
        assert usecase._export_service.results is None, (
            "Unsupported activity should not be tracked"
        )
