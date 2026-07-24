"""Unit tests for backfill configuration."""

from pydantic import ValidationError
import pytest

from stravapipe.config.backfill import BackfillConfig


@pytest.mark.parametrize("batch_size", [0, -1])
def test_rejects_non_positive_batch_size(batch_size: int):
    """Deployment configuration cannot silently disable batch processing."""
    with pytest.raises(ValidationError, match="greater than 0"):
        BackfillConfig(
            athlete_id="12345",
            gcp_project_id="test-project",
            strava_client_id="123",
            strava_client_secret="secret",
            postgres_connection_string="postgresql+psycopg://test",
            batch_size=batch_size,
        )
