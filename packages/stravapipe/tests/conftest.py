"""Shared test configuration and fixtures for stravapipe package."""

import pytest

from stravapipe.config import BQInserterConfig


@pytest.fixture
def mock_bq_inserter_config():
    """Mock BQ inserter configuration for tests."""
    return BQInserterConfig(
        gcp_project_id="test-project",
        gcp_bigquery_dataset="test_dataset",
    )
