"""Shared test configuration and fixtures for desirelines package."""

import pytest

from desirelines.config import AggregatorConfig


@pytest.fixture
def mock_aggregator_config():
    """Mock aggregator configuration for desirelines tests."""
    return AggregatorConfig(
        gcp_project_id="test-project",
        gcp_bucket_name="test-bucket",
        strava_client_id=123,
        strava_client_secret="test_secret",
        strava_refresh_token="test_refresh",
    )
