"""Backfill service for bulk-syncing Strava activities to PostgreSQL and BigQuery.

This service coordinates fetching historical activities from the Strava API
and writing them to both PostgreSQL and BigQuery. It is designed to run as a
Cloud Run Job (not a long-lived server) triggered per-user after OAuth.

Unlike the webhook-driven services (PostgresWriteService, SyncService) which
handle single activities, BackfillService operates in bulk — fetching entire
years of activities and inserting in batches.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
import logging
import time
from typing import Protocol

from google.api_core import exceptions as gapi_exceptions

from stravapipe.adapters.gcp import ActivitiesWriter, MergeResult
from stravapipe.domain import (
    DetailedStravaActivity,
    StandardActivity,
    SummaryStravaActivity,
)
from stravapipe.ports.out.read import ReadDetailedActivities
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork

logger = logging.getLogger(__name__)

BATCH_SIZE = 100
BQ_MAX_BATCH_SIZE = 10_000

# Bounded in-batch retry around the BQ Storage Write API. Cloud Run Jobs
# have no Pub/Sub redelivery to absorb transients — a single 503 in a
# 1000-activity backfill would mark the chunk as failed and force a full
# job re-run (re-fetching every Strava activity and re-spending rate-limit
# quota). Webhook-path semantics are unchanged: this lives in the
# application layer, not in `BigQueryStorageWriter._send_serialized`.
#
# Non-retryable exceptions (InvalidArgument, PermissionDenied, NotFound,
# etc.) propagate immediately to the outer try/except in
# `_insert_to_bigquery` so the batch is logged + counted exactly once.
_BQ_RETRY_ATTEMPTS = 3
_BQ_RETRYABLE_EXCEPTIONS: tuple[type[BaseException], ...] = (
    gapi_exceptions.RetryError,
    gapi_exceptions.ServiceUnavailable,
    gapi_exceptions.DeadlineExceeded,
    TimeoutError,
)


@dataclass
class YearStats:
    """Statistics for a single year's backfill."""

    year: int
    activities_found: int = 0
    pg_inserted: int = 0
    pg_skipped: int = 0
    pg_errors: int = 0
    bq_inserted: int = 0
    bq_errors: int = 0
    duration_seconds: float = 0.0


@dataclass
class BackfillResult:
    """Aggregate result of a full backfill operation."""

    athlete_id: str
    years: list[int] = field(default_factory=list)
    year_stats: list[YearStats] = field(default_factory=list)
    total_activities: int = 0
    total_pg_inserted: int = 0
    total_bq_inserted: int = 0
    total_errors: int = 0
    duration_seconds: float = 0.0

    @property
    def success(self) -> bool:
        return self.total_errors == 0


class ProgressReporter(Protocol):
    """Protocol for reporting backfill progress (e.g. to Firestore)."""

    def report_started(self, athlete_id: str, years: list[int]) -> None: ...

    def report_year_complete(
        self, athlete_id: str, year: int, activities_count: int
    ) -> None: ...

    def report_completed(self, athlete_id: str, result: BackfillResult) -> None: ...

    def report_failed(self, athlete_id: str, error: str) -> None: ...


class NoOpProgressReporter:
    """Default reporter that does nothing. Used when no Firestore is available."""

    def report_started(self, athlete_id: str, years: list[int]) -> None:
        pass

    def report_year_complete(
        self, athlete_id: str, year: int, activities_count: int
    ) -> None:
        pass

    def report_completed(self, athlete_id: str, result: BackfillResult) -> None:
        pass

    def report_failed(self, athlete_id: str, error: str) -> None:
        pass


class BackfillService:
    """Service for backfilling historical Strava activities.

    Fetches activities from Strava API by year and writes them to
    PostgreSQL and BigQuery in batches.

    Uses dependency injection for all external dependencies:
    - strava_reader: Fetches activities from Strava API (paginated by year)
    - uow_factory: Creates Unit of Work instances for PostgreSQL transactions
    - bq_writer: Writes activity batches to BigQuery (optional)
    - progress_reporter: Reports progress to external system (optional)

    Usage:
        service = BackfillService(
            strava_reader=strava_repo,
            uow_factory=lambda: SqlAlchemyUnitOfWork(session_factory),
            bq_writer=activities_writer,
        )
        result = service.backfill_user("12345", years=[2023, 2024, 2025])
    """

    def __init__(
        self,
        strava_reader: ReadDetailedActivities,
        uow_factory: Callable[[], AbstractUnitOfWork],
        bq_writer: ActivitiesWriter | None = None,
        progress_reporter: ProgressReporter | None = None,
        batch_size: int = BATCH_SIZE,
    ):
        self._strava_reader = strava_reader
        self._uow_factory = uow_factory
        self._bq_writer = bq_writer
        self._progress = progress_reporter or NoOpProgressReporter()
        self._batch_size = batch_size

    def backfill_user(self, athlete_id: str, years: list[int]) -> BackfillResult:
        """Backfill all specified years for a user.

        Args:
            athlete_id: Strava athlete ID (for logging and progress reporting)
            years: List of years to backfill

        Returns:
            BackfillResult with aggregate statistics
        """
        start_time = time.monotonic()
        sorted_years = sorted(years)

        result = BackfillResult(athlete_id=athlete_id, years=sorted_years)
        self._progress.report_started(athlete_id, sorted_years)

        logger.info(
            "Starting backfill for athlete %s, years: %s",
            athlete_id,
            sorted_years,
        )

        for year in sorted_years:
            try:
                year_stats = self._backfill_year(year)
                result.year_stats.append(year_stats)
                result.total_activities += year_stats.activities_found
                result.total_pg_inserted += year_stats.pg_inserted
                result.total_bq_inserted += year_stats.bq_inserted
                result.total_errors += year_stats.pg_errors + year_stats.bq_errors

                self._progress.report_year_complete(
                    athlete_id, year, year_stats.activities_found
                )
            except Exception:
                logger.exception(
                    "Failed to backfill year %d for athlete %s",
                    year,
                    athlete_id,
                )
                result.year_stats.append(YearStats(year=year, pg_errors=1))
                result.total_errors += 1

        result.duration_seconds = time.monotonic() - start_time

        if result.success:
            self._progress.report_completed(athlete_id, result)
            logger.info(
                "Backfill completed for athlete %s: %d activities across %d years "
                "(PG: %d inserted, BQ: %d inserted) in %.1fs",
                athlete_id,
                result.total_activities,
                len(sorted_years),
                result.total_pg_inserted,
                result.total_bq_inserted,
                result.duration_seconds,
            )
        else:
            self._progress.report_failed(
                athlete_id,
                f"Completed with {result.total_errors} errors",
            )
            logger.warning(
                "Backfill completed with errors for athlete %s: %d errors",
                athlete_id,
                result.total_errors,
            )

        return result

    def _backfill_year(self, year: int) -> YearStats:
        """Backfill a single year.

        1. Fetch activities from Strava API
        2. Insert to PostgreSQL in batches
        3. Insert to BigQuery in batches (if writer configured)
        """
        start_time = time.monotonic()

        logger.info("Fetching activities from Strava for %d", year)
        activities = self._strava_reader.read_activities_by_year(year)
        logger.info("Found %d activities in %d", len(activities), year)

        if not activities:
            return YearStats(year=year)

        stats = YearStats(year=year, activities_found=len(activities))

        # Insert to PostgreSQL
        pg_inserted, pg_skipped, pg_errors = self._insert_to_postgres(activities)
        stats.pg_inserted = pg_inserted
        stats.pg_skipped = pg_skipped
        stats.pg_errors = pg_errors

        # Insert to BigQuery (optional)
        if self._bq_writer is not None:
            bq_inserted, bq_errors = self._insert_to_bigquery(activities)
            stats.bq_inserted = bq_inserted
            stats.bq_errors = bq_errors

        stats.duration_seconds = time.monotonic() - start_time

        logger.info(
            "Year %d complete in %.1fs: PG(%d inserted, %d skipped, %d errors), "
            "BQ(%d inserted, %d errors)",
            year,
            stats.duration_seconds,
            stats.pg_inserted,
            stats.pg_skipped,
            stats.pg_errors,
            stats.bq_inserted,
            stats.bq_errors,
        )

        return stats

    def _insert_to_postgres(
        self,
        activities: Sequence[DetailedStravaActivity | SummaryStravaActivity],
    ) -> tuple[int, int, int]:
        """Insert activities to PostgreSQL in batches.

        Returns:
            Tuple of (inserted_count, skipped_count, error_count)
        """
        inserted_count = 0
        skipped_count = 0
        error_count = 0

        total_batches = (len(activities) + self._batch_size - 1) // self._batch_size

        for batch_num, i in enumerate(
            range(0, len(activities), self._batch_size), start=1
        ):
            batch = activities[i : i + self._batch_size]

            try:
                batch_inserted = 0
                batch_skipped = 0

                uow = self._uow_factory()
                with uow:
                    for activity in batch:
                        standard = StandardActivity.model_validate(
                            activity, from_attributes=True
                        )
                        if uow.activities.insert(standard):
                            batch_inserted += 1
                        else:
                            batch_skipped += 1
                    uow.commit()

                inserted_count += batch_inserted
                skipped_count += batch_skipped

                logger.info(
                    "PG batch %d/%d: %d inserted, %d skipped",
                    batch_num,
                    total_batches,
                    batch_inserted,
                    batch_skipped,
                )
            except Exception:
                error_count += len(batch)
                logger.exception("PG batch %d/%d failed", batch_num, total_batches)

        return inserted_count, skipped_count, error_count

    def _insert_to_bigquery(
        self,
        activities: Sequence[DetailedStravaActivity | SummaryStravaActivity],
    ) -> tuple[int, int]:
        """Insert activities to BigQuery in batches.

        Returns:
            Tuple of (inserted_count, error_count)
        """
        assert self._bq_writer is not None

        inserted_count = 0
        error_count = 0

        total_batches = (len(activities) + BQ_MAX_BATCH_SIZE - 1) // BQ_MAX_BATCH_SIZE

        for batch_num, i in enumerate(
            range(0, len(activities), BQ_MAX_BATCH_SIZE), start=1
        ):
            batch = list(activities[i : i + BQ_MAX_BATCH_SIZE])

            try:
                result = self._write_batch_with_retry(
                    batch, batch_num=batch_num, total_batches=total_batches
                )
                rows_affected = result["rows_affected"]
                inserted_count += rows_affected

                logger.info(
                    "BQ batch %d/%d: %d rows affected",
                    batch_num,
                    total_batches,
                    rows_affected,
                )
            except Exception:
                error_count += len(batch)
                logger.exception("BQ batch %d/%d failed", batch_num, total_batches)

        return inserted_count, error_count

    def _write_batch_with_retry(
        self,
        batch: list[DetailedStravaActivity | SummaryStravaActivity],
        *,
        batch_num: int,
        total_batches: int,
    ) -> MergeResult:
        """Call the BQ writer with bounded exponential-backoff retry.

        Retries only the transient classes in ``_BQ_RETRYABLE_EXCEPTIONS``;
        everything else (schema drift, IAM, missing table, …) is
        re-raised on the first attempt so the caller logs + counts the
        batch as errored exactly once.
        """
        assert self._bq_writer is not None
        for attempt in range(1, _BQ_RETRY_ATTEMPTS + 1):
            try:
                return self._bq_writer.write_activities_batch(batch)
            except _BQ_RETRYABLE_EXCEPTIONS as exc:
                if attempt == _BQ_RETRY_ATTEMPTS:
                    raise
                backoff = 2 ** (attempt - 1)
                logger.warning(
                    "BQ batch %d/%d transient failure "
                    "(attempt %d/%d: %s) — retrying in %ds",
                    batch_num,
                    total_batches,
                    attempt,
                    _BQ_RETRY_ATTEMPTS,
                    type(exc).__name__,
                    backoff,
                )
                time.sleep(backoff)
        # Unreachable: the loop returns on success or re-raises on the
        # final attempt. Present to satisfy mypy's exhaustiveness check.
        raise RuntimeError("unreachable")
