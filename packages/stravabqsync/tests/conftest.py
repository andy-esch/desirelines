"""Shared test configuration and fixtures."""

import pytest

from stravabqsync.config import BQInserterConfig


@pytest.fixture(autouse=True)
def mock_config():
    """Mock the configuration loading for all tests."""
    return BQInserterConfig(
        gcp_project_id="test-project",
        gcp_bigquery_dataset="test_dataset",
        strava_client_id=123,
        strava_client_secret="test_secret",
        strava_refresh_token="test_refresh",
    )
