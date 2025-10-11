"""Shared test configuration and fixtures for stravapipe package."""

import pytest

from stravapipe.config import AggregatorConfig, BQInserterConfig


@pytest.fixture
def mock_bq_inserter_config():
    """Mock BQ inserter configuration for tests."""
    return BQInserterConfig(
        gcp_project_id="test-project",
        gcp_bigquery_dataset="test_dataset",
        strava_client_id=123,
        strava_client_secret="test_secret",
        strava_refresh_token="test_refresh",
    )


@pytest.fixture
def mock_aggregator_config():
    """Mock aggregator configuration for tests."""
    return AggregatorConfig(
        gcp_project_id="test-project",
        gcp_bucket_name="test-bucket",
        strava_client_id=123,
        strava_client_secret="test_secret",
        strava_refresh_token="test_refresh",
    )
