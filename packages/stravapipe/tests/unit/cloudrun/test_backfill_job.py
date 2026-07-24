"""Unit tests for the backfill Cloud Run Job terminal summary."""

from unittest.mock import patch

import pytest

from stravapipe.application.backfill import BackfillResult
from stravapipe.cloudrun.backfill_job import _log_result


@pytest.mark.parametrize(
    ("total_errors", "expected_exit_code", "log_method", "status"),
    [
        (0, 0, "info", "succeeded"),
        (2, 1, "error", "completed with errors"),
    ],
)
def test_log_result_uses_consistent_terminal_metrics(
    total_errors: int,
    expected_exit_code: int,
    log_method: str,
    status: str,
):
    """Success and failure expose the same inserted/updated/error fields."""
    result = BackfillResult(
        athlete_id="12345",
        total_activities=7,
        total_pg_inserted=3,
        total_pg_updated=4,
        total_bq_inserted=7,
        total_errors=total_errors,
        duration_seconds=12.5,
    )

    with patch("stravapipe.cloudrun.backfill_job.logger") as mock_logger:
        exit_code = _log_result(result)

    assert exit_code == expected_exit_code
    log = getattr(mock_logger, log_method)
    log.assert_called_once_with(
        "Backfill %s: %d activities "
        "(PG: %d inserted, %d updated; BQ: %d inserted; errors: %d) in %.1fs",
        status,
        7,
        3,
        4,
        7,
        total_errors,
        12.5,
    )
