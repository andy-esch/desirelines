"""Unit tests for the backfill Cloud Run Job terminal summary."""

from unittest.mock import MagicMock, patch

import pytest

from stravapipe.application.backfill import BackfillResult
from stravapipe.cloudrun.backfill_job import _cleanup_resources, _log_result


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


@pytest.mark.parametrize(
    ("total_errors", "expected_exit_code", "log_method"),
    [(0, 0, "info"), (1, 1, "error")],
)
def test_log_result_preserves_exit_code_when_logging_fails(
    total_errors: int,
    expected_exit_code: int,
    log_method: str,
):
    result = BackfillResult(athlete_id="12345", total_errors=total_errors)

    with patch("stravapipe.cloudrun.backfill_job.logger") as mock_logger:
        getattr(mock_logger, log_method).side_effect = RuntimeError(
            "logging unavailable"
        )
        exit_code = _log_result(result)

    assert exit_code == expected_exit_code


def test_cleanup_resources_disposes_postgres_after_bigquery_close_failure():
    bq_writer = MagicMock()
    db_engine = MagicMock()
    bq_writer.close.side_effect = RuntimeError("close failed")

    _cleanup_resources(bq_writer=bq_writer, db_engine=db_engine)

    bq_writer.close.assert_called_once_with()
    db_engine.dispose.assert_called_once_with()


def test_cleanup_resources_never_masks_outcome_when_all_cleanup_logging_fails():
    bq_writer = MagicMock()
    db_engine = MagicMock()
    bq_writer.close.side_effect = RuntimeError("BQ close failed")
    db_engine.dispose.side_effect = RuntimeError("PG dispose failed")

    with patch("stravapipe.cloudrun.backfill_job.logger") as mock_logger:
        mock_logger.error.side_effect = RuntimeError("logging failed")
        _cleanup_resources(bq_writer=bq_writer, db_engine=db_engine)

    bq_writer.close.assert_called_once_with()
    db_engine.dispose.assert_called_once_with()
