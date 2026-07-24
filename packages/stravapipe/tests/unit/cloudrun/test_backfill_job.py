"""Unit tests for the backfill Cloud Run Job composition root and summary."""

from unittest.mock import DEFAULT, MagicMock, patch

import pytest

from stravapipe.application.backfill import BackfillResult
from stravapipe.cloudrun.backfill_job import _cleanup_resources, _log_result, main


@pytest.fixture
def backfill_main_mocks():
    """Patch external dependencies while retaining the real composition logic."""
    targets = (
        "new_correlation_id",
        "setup_tracing",
        "load_backfill_config",
        "FirestoreClient",
        "FirestoreTokenStore",
        "create_strava_activities_repo",
        "create_session_factory",
        "instrument_sqlalchemy_engine",
        "SqlAlchemyUnitOfWork",
        "make_write_activities",
        "BackfillService",
        "shutdown_tracing",
    )
    replacements = dict.fromkeys(targets, DEFAULT)

    with (
        patch.multiple(
            "stravapipe.cloudrun.backfill_job",
            **replacements,
        ) as mocks,
        patch("stravapipe.cloudrun.backfill_job.sys.exit") as exit_mock,
    ):
        config = MagicMock()
        config.athlete_id = "15339103"
        config.years = [2024]
        config.gcp_project_id = "desirelines-dev"
        config.gcp_bigquery_dataset = "desirelines"
        config.firestore_database = "desirelines"
        config.strava_client_id = "123"
        config.strava_client_secret = "client-secret"
        config.postgres_connection_string = "postgresql://example"
        config.batch_size = 100
        mocks["load_backfill_config"].return_value = config

        token_data = MagicMock(
            access_token="access-token",
            refresh_token="refresh-token",
        )
        mocks["FirestoreTokenStore"].return_value.get_tokens.return_value = token_data

        engine = MagicMock()
        session_factory = MagicMock()
        mocks["create_session_factory"].return_value = (engine, session_factory)

        tracer = MagicMock()
        mocks["setup_tracing"].return_value = tracer

        mocks["sys_exit"] = exit_mock
        mocks["config"] = config
        mocks["engine"] = engine
        mocks["session_factory"] = session_factory
        mocks["tracer"] = tracer
        yield mocks


@pytest.mark.parametrize(
    (
        "total_errors",
        "total_source_errors",
        "expected_exit_code",
        "log_method",
        "status",
    ),
    [
        (0, 0, 0, "info", "succeeded"),
        (2, 1, 1, "error", "completed with errors"),
    ],
)
def test_log_result_uses_consistent_terminal_metrics(
    total_errors: int,
    total_source_errors: int,
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
        total_source_errors=total_source_errors,
        total_errors=total_errors,
        duration_seconds=12.5,
    )

    with patch("stravapipe.cloudrun.backfill_job.logger") as mock_logger:
        exit_code = _log_result(result)

    assert exit_code == expected_exit_code
    log = getattr(mock_logger, log_method)
    log.assert_called_once_with(
        "Backfill %s: %d activities "
        "(source errors: %d; processing errors: %d; "
        "PG: %d inserted, %d updated; BQ: %d inserted; errors: %d) in %.1fs",
        status,
        7,
        total_source_errors,
        0,
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
    cleanup_order: list[str] = []

    def close_bigquery() -> None:
        cleanup_order.append("bigquery")
        raise RuntimeError("close failed")

    bq_writer.close.side_effect = close_bigquery
    db_engine.dispose.side_effect = lambda: cleanup_order.append("postgres")

    with patch(
        "stravapipe.cloudrun.backfill_job.shutdown_tracing",
        side_effect=lambda: cleanup_order.append("tracing"),
    ):
        _cleanup_resources(bq_writer=bq_writer, db_engine=db_engine)

    bq_writer.close.assert_called_once_with()
    db_engine.dispose.assert_called_once_with()
    assert cleanup_order == ["bigquery", "postgres", "tracing"]


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


@pytest.mark.parametrize(
    ("total_errors", "expected_exit_code"),
    [(0, 0), (1, 1)],
)
@pytest.mark.parametrize("bq_dataset", ["desirelines", ""])
def test_main_threads_tracer_and_preserves_exit_during_flush_failure(
    backfill_main_mocks,
    total_errors: int,
    expected_exit_code: int,
    bq_dataset: str,
):
    """Both sink modes share one tracer and flush without changing exit status."""
    mocks = backfill_main_mocks
    mocks["config"].gcp_bigquery_dataset = bq_dataset
    result = BackfillResult(athlete_id="15339103", total_errors=total_errors)
    mocks["BackfillService"].return_value.backfill_user.return_value = result
    mocks["shutdown_tracing"].side_effect = RuntimeError("span flush failed")

    main()

    mocks["instrument_sqlalchemy_engine"].assert_called_once_with(mocks["engine"])

    service_kwargs = mocks["BackfillService"].call_args.kwargs
    assert service_kwargs["tracer"] is mocks["tracer"]
    uow = service_kwargs["uow_factory"]()
    mocks["SqlAlchemyUnitOfWork"].assert_called_once_with(
        mocks["session_factory"],
        tracer=mocks["tracer"],
    )
    assert uow is mocks["SqlAlchemyUnitOfWork"].return_value

    if bq_dataset:
        mocks["make_write_activities"].assert_called_once_with(
            project_id="desirelines-dev",
            bq_dataset=bq_dataset,
            tracer=mocks["tracer"],
        )
        assert (
            service_kwargs["bq_writer"] is mocks["make_write_activities"].return_value
        )
        mocks["make_write_activities"].return_value.close.assert_called_once_with()
    else:
        mocks["make_write_activities"].assert_not_called()
        assert service_kwargs["bq_writer"] is None

    mocks["engine"].dispose.assert_called_once_with()
    mocks["shutdown_tracing"].assert_called_once_with()
    mocks["sys_exit"].assert_called_once_with(expected_exit_code)


def test_main_flushes_tracing_when_backfill_raises(backfill_main_mocks):
    """Unexpected job failure keeps its identity while teardown still flushes."""
    mocks = backfill_main_mocks
    backfill_error = RuntimeError("backfill crashed")
    mocks["BackfillService"].return_value.backfill_user.side_effect = backfill_error

    with pytest.raises(RuntimeError, match="backfill crashed") as caught:
        main()

    assert caught.value is backfill_error
    mocks["make_write_activities"].return_value.close.assert_called_once_with()
    mocks["engine"].dispose.assert_called_once_with()
    mocks["shutdown_tracing"].assert_called_once_with()
    mocks["sys_exit"].assert_not_called()
