"""Backfill service for bulk-syncing Strava activities to PostgreSQL and BigQuery.

This service coordinates fetching historical activities from the Strava API
and writing them to both PostgreSQL and BigQuery. It is designed to run as a
Cloud Run Job (not a long-lived server) triggered per-user after OAuth.

Unlike the webhook-driven write path (which handles single activities inline
from the dispatcher's enriched events), BackfillService operates in bulk —
fetching entire years of activities and inserting in batches.
"""

from collections.abc import Callable, Iterator, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from functools import partial
import logging
import time
from typing import Protocol

from google.api_core import exceptions as gapi_exceptions
from opentelemetry.context import Context
from opentelemetry.trace import Tracer
from sqlalchemy import exc as sa_exc

from stravapipe.adapters.gcp import ActivitiesWriter, MergeResult
from stravapipe.domain import (
    DetailedStravaActivity,
    StandardActivity,
    SummaryStravaActivity,
    is_non_geographic_activity,
)
from stravapipe.domain.geometry import decode_polyline_to_geojson
from stravapipe.ports.out.postgres import ActivityRepository
from stravapipe.ports.out.read import ReadDetailedActivities
from stravapipe.ports.out.unit_of_work import AbstractUnitOfWork
from stravapipe.shared.logging import log_best_effort
from stravapipe.shared.tracing import record_span

logger = logging.getLogger(__name__)

BATCH_SIZE = 100
BQ_MAX_BATCH_SIZE = 10_000


def _iter_batches[T](
    seq: Sequence[T], size: int
) -> Iterator[tuple[int, int, Sequence[T]]]:
    """Yield ``(batch_num, total_batches, batch)`` over ``seq`` in ``size`` chunks.

    Owns the ceil-div + ``enumerate(range(...))`` arithmetic shared by the
    PostgreSQL and BigQuery insert loops so the chunk-boundary logic has one
    home to test. ``batch_num`` is 1-based.
    """
    total = (len(seq) + size - 1) // size
    for batch_num, i in enumerate(range(0, len(seq), size), start=1):
        yield batch_num, total, seq[i : i + size]


def _upsert_activity(
    repository: ActivityRepository,
    activity: StandardActivity,
) -> None:
    """Upsert one activity, failing loudly if the repository affects no row."""
    success = repository.upsert(activity)
    if not success:
        raise RuntimeError(
            f"PostgreSQL upsert affected no row for activity {activity.id}"
        )


def _reconcile_activity_geography(
    repository: ActivityRepository,
    activity: StandardActivity,
) -> None:
    """Reconcile one activity's missing route and region tags transactionally."""
    if is_non_geographic_activity(activity):
        repository.clear_activity_regions(activity.id)
        return

    encoded_route = None
    if activity.map is not None:
        encoded_route = activity.map.polyline or activity.map.summary_polyline

    if encoded_route:
        geojson = decode_polyline_to_geojson(encoded_route)
        if geojson is not None:
            # False is an expected conflict: preserve the stored route and
            # reconcile its regions below.
            repository.insert_route(activity.id, geojson)
        else:
            log_best_effort(
                partial(
                    logger.warning,
                    "Activity %s has a polyline but decoded to no geometry; "
                    "route insertion skipped before region reconciliation",
                    activity.id,
                    extra={
                        "user_id": activity.user_id,
                        "polyline_length": len(encoded_route),
                    },
                )
            )

    # Always reconcile geographic activities from the route PostgreSQL stores.
    # This repairs stale tags after an insert conflict and clears stale tags when
    # neither an incoming nor existing route is available.
    repository.tag_activity_regions(activity.id)


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

# PostgreSQL retries are deliberately narrower than the BigQuery policy:
# retry the entire transaction with a fresh Unit of Work only when a transient
# failure happens before commit is invoked. A commit exception is ambiguous
# (the server may have accepted it), and a post-commit cleanup failure must not
# replay or reclassify durable writes.
_PG_RETRY_ATTEMPTS = 3
_PG_RETRYABLE_EXCEPTIONS: tuple[type[BaseException], ...] = (
    sa_exc.OperationalError,
    sa_exc.TimeoutError,
)
_PG_NON_RETRYABLE_DBAPI_EXCEPTIONS: tuple[type[BaseException], ...] = (
    sa_exc.IntegrityError,
    sa_exc.DataError,
    sa_exc.ProgrammingError,
)


def _is_retryable_postgres_exception(exc: BaseException) -> bool:
    """Return whether a pre-commit PostgreSQL failure may replay safely."""
    if isinstance(exc, _PG_NON_RETRYABLE_DBAPI_EXCEPTIONS):
        return False
    if isinstance(exc, _PG_RETRYABLE_EXCEPTIONS):
        return True
    return isinstance(exc, sa_exc.DBAPIError) and exc.connection_invalidated


@dataclass
class YearStats:
    """Statistics for a single year's backfill.

    ``source_errors`` and ``processing_errors`` count failed year attempts.
    PostgreSQL and BigQuery error fields count affected activity rows, so the
    PostgreSQL inserted + updated + errors partition applies only to
    ``activities_found`` after a successful source read.
    """

    year: int
    activities_found: int = 0
    source_errors: int = 0
    processing_errors: int = 0
    pg_inserted: int = 0
    pg_updated: int = 0
    pg_errors: int = 0
    bq_inserted: int = 0
    bq_errors: int = 0
    duration_seconds: float = 0.0


@dataclass
class PostgresWriteStats:
    """Committed PostgreSQL activity-write outcomes."""

    inserted: int = 0
    updated: int = 0
    errors: int = 0


def _log_committed_postgres_batch(
    *,
    batch_num: int,
    total_batches: int,
    inserted: int,
    updated: int,
) -> None:
    """Log a committed batch without letting logging alter its data outcome."""
    log_best_effort(
        partial(
            logger.info,
            "PG batch %d/%d: %d inserted, %d updated, 0 errors",
            batch_num,
            total_batches,
            inserted,
            updated,
        )
    )


def _log_failed_postgres_batch(
    *,
    batch_num: int,
    total_batches: int,
    errors: int,
) -> None:
    """Log a failed batch without interrupting later batches."""
    log_best_effort(
        partial(
            logger.exception,
            "PG batch %d/%d: 0 inserted, 0 updated, %d errors",
            batch_num,
            total_batches,
            errors,
        )
    )


def _log_postgres_cleanup_failure(
    *,
    batch_num: int,
    total_batches: int,
    inserted: int,
    updated: int,
    error: Exception,
) -> None:
    """Report post-commit cleanup failure without changing committed counts."""
    log_best_effort(
        partial(
            logger.error,
            "PG batch %d/%d cleanup failed after commit (%s); "
            "%d inserted and %d updated remain authoritative",
            batch_num,
            total_batches,
            type(error).__name__,
            inserted,
            updated,
            exc_info=(type(error), error, error.__traceback__),
        )
    )


def _log_postgres_retry(
    *,
    batch_num: int,
    total_batches: int,
    attempt: int,
    error: Exception,
    backoff: int,
) -> None:
    """Log a retry without allowing observability to prevent the retry."""
    log_best_effort(
        partial(
            logger.warning,
            "PG batch %d/%d transient pre-commit failure "
            "(attempt %d/%d: %s) — retrying with a fresh transaction in %ds",
            batch_num,
            total_batches,
            attempt,
            _PG_RETRY_ATTEMPTS,
            type(error).__name__,
            backoff,
        )
    )


@dataclass
class BackfillResult:
    """Aggregate result of a full backfill operation.

    ``total_errors`` is the terminal process-status total across failed source
    reads, unexpected year processing failures, and sink row errors. The
    explicit source/processing totals preserve their distinct operator meaning.
    """

    athlete_id: str
    years: list[int] = field(default_factory=list)
    year_stats: list[YearStats] = field(default_factory=list)
    total_activities: int = 0
    total_source_errors: int = 0
    total_processing_errors: int = 0
    total_pg_inserted: int = 0
    total_pg_updated: int = 0
    total_bq_inserted: int = 0
    total_errors: int = 0
    duration_seconds: float = 0.0

    @property
    def success(self) -> bool:
        return self.total_errors == 0


class ProgressReporter(Protocol):
    """Protocol for reporting backfill progress (e.g. to Firestore).

    Mutable payloads are defensive snapshots. Reporter implementations may
    retain or transform them without affecting the backfill's control flow or
    returned result.
    """

    def report_started(self, athlete_id: str, years: list[int]) -> None: ...

    def report_year_complete(self, athlete_id: str, stats: YearStats) -> None: ...

    def report_completed(self, athlete_id: str, result: BackfillResult) -> None: ...

    def report_failed(self, athlete_id: str, error: str) -> None: ...


class NoOpProgressReporter:
    """Default reporter that does nothing. Used when no Firestore is available."""

    def report_started(self, athlete_id: str, years: list[int]) -> None:
        pass

    def report_year_complete(self, athlete_id: str, stats: YearStats) -> None:
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
    - tracer: Parents each year's Strava and sink work under a bounded root span

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
        tracer: Tracer | None = None,
    ):
        if batch_size <= 0:
            raise ValueError("batch_size must be greater than zero")

        self._strava_reader = strava_reader
        self._uow_factory = uow_factory
        self._bq_writer = bq_writer
        self._progress = progress_reporter or NoOpProgressReporter()
        self._batch_size = batch_size
        self._tracer = tracer

    def backfill_user(self, athlete_id: str, years: list[int]) -> BackfillResult:
        """Backfill all specified years for a user.

        Each year starts an independent root trace by supplying an empty OTel
        context explicitly. Strava work and PostgreSQL/BigQuery child spans
        inherit that active year span, while trace size remains bounded and an
        ambient request or webhook trace can never become the backfill parent.

        Args:
            athlete_id: Strava athlete ID (for logging and progress reporting)
            years: List of years to backfill

        Returns:
            BackfillResult with aggregate statistics
        """
        start_time = time.monotonic()
        sorted_years = sorted(years)

        result = BackfillResult(athlete_id=athlete_id, years=sorted_years)
        self._report_progress(
            "started",
            athlete_id,
            partial(
                self._progress.report_started,
                athlete_id,
                deepcopy(sorted_years),
            ),
        )

        log_best_effort(
            partial(
                logger.info,
                "Starting backfill for athlete %s, years: %s",
                athlete_id,
                sorted_years,
            )
        )

        for year in sorted_years:
            try:
                with record_span(
                    self._tracer,
                    "backfill.year",
                    {
                        "desirelines.athlete_id": athlete_id,
                        "desirelines.backfill.year": year,
                    },
                    parent_context=Context(),
                ):
                    year_stats = self._backfill_year(year)
            except Exception:
                log_best_effort(
                    partial(
                        logger.exception,
                        "Failed to backfill year %d for athlete %s",
                        year,
                        athlete_id,
                    )
                )
                year_stats = YearStats(year=year, processing_errors=1)

            result.year_stats.append(year_stats)
            result.total_activities += year_stats.activities_found
            result.total_source_errors += year_stats.source_errors
            result.total_processing_errors += year_stats.processing_errors
            result.total_pg_inserted += year_stats.pg_inserted
            result.total_pg_updated += year_stats.pg_updated
            result.total_bq_inserted += year_stats.bq_inserted
            result.total_errors += (
                year_stats.source_errors
                + year_stats.processing_errors
                + year_stats.pg_errors
                + year_stats.bq_errors
            )

            self._report_progress(
                "year_complete",
                athlete_id,
                partial(
                    self._progress.report_year_complete,
                    athlete_id,
                    deepcopy(year_stats),
                ),
            )

        result.duration_seconds = time.monotonic() - start_time
        year_count = len(sorted_years)
        year_label = "year" if year_count == 1 else "years"

        if result.success:
            self._report_progress(
                "completed",
                athlete_id,
                partial(
                    self._progress.report_completed,
                    athlete_id,
                    deepcopy(result),
                ),
            )
            log_best_effort(
                partial(
                    logger.info,
                    "Backfill completed for athlete %s: %d activities across %d %s "
                    "(source errors: %d; processing errors: %d; "
                    "PG: %d inserted, %d updated; "
                    "BQ: %d inserted; errors: %d) in %.1fs",
                    athlete_id,
                    result.total_activities,
                    year_count,
                    year_label,
                    result.total_source_errors,
                    result.total_processing_errors,
                    result.total_pg_inserted,
                    result.total_pg_updated,
                    result.total_bq_inserted,
                    result.total_errors,
                    result.duration_seconds,
                )
            )
        else:
            self._report_progress(
                "failed",
                athlete_id,
                partial(
                    self._progress.report_failed,
                    athlete_id,
                    f"Completed with {result.total_errors} errors "
                    f"({result.total_source_errors} source, "
                    f"{result.total_processing_errors} processing)",
                ),
            )
            log_best_effort(
                partial(
                    logger.warning,
                    "Backfill completed with errors for athlete %s: %d activities "
                    "across %d %s (source errors: %d; processing errors: %d; "
                    "PG: %d inserted, %d updated; "
                    "BQ: %d inserted; errors: %d) in %.1fs",
                    athlete_id,
                    result.total_activities,
                    year_count,
                    year_label,
                    result.total_source_errors,
                    result.total_processing_errors,
                    result.total_pg_inserted,
                    result.total_pg_updated,
                    result.total_bq_inserted,
                    result.total_errors,
                    result.duration_seconds,
                )
            )

        return result

    @staticmethod
    def _report_progress(
        event: str,
        athlete_id: str,
        callback: Callable[[], None],
    ) -> None:
        """Report progress without letting control-plane failures alter data results."""
        try:
            callback()
        except Exception:
            log_best_effort(
                partial(
                    logger.exception,
                    "Progress reporter failed during %s for athlete %s",
                    event,
                    athlete_id,
                )
            )

    def _backfill_year(self, year: int) -> YearStats:
        """Backfill a single year.

        1. Fetch activities from Strava API
        2. Insert to PostgreSQL in batches
        3. Insert to BigQuery in batches (if writer configured)
        """
        start_time = time.monotonic()

        log_best_effort(
            partial(logger.info, "Fetching activities from Strava for %d", year)
        )
        try:
            activities = self._strava_reader.read_activities_by_year(year)
        except Exception:
            log_best_effort(
                partial(
                    logger.exception,
                    "Failed to fetch activities from Strava for %d",
                    year,
                )
            )
            return YearStats(
                year=year,
                source_errors=1,
                duration_seconds=time.monotonic() - start_time,
            )
        log_best_effort(
            partial(
                logger.info,
                "Found %d activities in %d",
                len(activities),
                year,
            )
        )

        if not activities:
            return YearStats(
                year=year,
                duration_seconds=time.monotonic() - start_time,
            )

        stats = YearStats(year=year, activities_found=len(activities))

        # Upsert to PostgreSQL
        pg_stats = self._insert_to_postgres(activities)
        stats.pg_inserted = pg_stats.inserted
        stats.pg_updated = pg_stats.updated
        stats.pg_errors = pg_stats.errors

        # Insert to BigQuery (optional)
        if self._bq_writer is not None:
            bq_inserted, bq_errors = self._insert_to_bigquery(activities)
            stats.bq_inserted = bq_inserted
            stats.bq_errors = bq_errors

        stats.duration_seconds = time.monotonic() - start_time

        log_best_effort(
            partial(
                logger.info,
                "Year %d complete in %.1fs: "
                "PG(%d inserted, %d updated, %d errors), "
                "BQ(%d inserted, %d errors)",
                year,
                stats.duration_seconds,
                stats.pg_inserted,
                stats.pg_updated,
                stats.pg_errors,
                stats.bq_inserted,
                stats.bq_errors,
            )
        )

        return stats

    def _insert_to_postgres(
        self,
        activities: Sequence[DetailedStravaActivity | SummaryStravaActivity],
    ) -> PostgresWriteStats:
        """Upsert activities to PostgreSQL in batches.

        Inserted vs updated is classified from a batch pre-read. Counts are
        promoted once ``commit()`` returns. Eligible pre-commit connectivity
        failures retry the whole batch with a fresh Unit of Work. A commit
        exception is inherently ambiguous because the database may have accepted
        the transaction before the client observed the failure; it is counted as
        a failed batch because no authoritative committed classification is
        available. Cleanup or logging failures after a successful commit never
        reclassify those rows.
        """
        stats = PostgresWriteStats()

        for batch_num, total_batches, batch in _iter_batches(
            activities, self._batch_size
        ):
            try:
                batch_stats = self._insert_pg_batch_with_retry(
                    batch,
                    batch_num=batch_num,
                    total_batches=total_batches,
                )
            except Exception:
                stats.errors += len(batch)
                _log_failed_postgres_batch(
                    batch_num=batch_num,
                    total_batches=total_batches,
                    errors=len(batch),
                )
                continue

            stats.inserted += batch_stats.inserted
            stats.updated += batch_stats.updated

            _log_committed_postgres_batch(
                batch_num=batch_num,
                total_batches=total_batches,
                inserted=batch_stats.inserted,
                updated=batch_stats.updated,
            )

        return stats

    def _insert_pg_batch_with_retry(
        self,
        batch: Sequence[DetailedStravaActivity | SummaryStravaActivity],
        *,
        batch_num: int,
        total_batches: int,
    ) -> PostgresWriteStats:
        """Write one PostgreSQL batch with phase-aware transient retry.

        Every attempt owns a fresh Unit of Work and recomputes inserted/updated
        classification. Only eligible failures before ``commit()`` is invoked
        may retry. A commit exception is ambiguous and propagates immediately;
        cleanup failure after a successful commit preserves durable counts.
        """
        for attempt in range(1, _PG_RETRY_ATTEMPTS + 1):
            batch_inserted = 0
            batch_updated = 0
            commit_attempted = False
            commit_succeeded = False
            cleanup_error: Exception | None = None

            try:
                uow = self._uow_factory()
                with uow:
                    existing_ids = uow.activities.get_existing_ids(
                        [activity.id for activity in batch]
                    )
                    for activity in batch:
                        standard = StandardActivity.model_validate(
                            activity, from_attributes=True
                        )
                        _upsert_activity(uow.activities, standard)
                        _reconcile_activity_geography(uow.activities, standard)
                        if activity.id in existing_ids:
                            batch_updated += 1
                        else:
                            batch_inserted += 1
                    commit_attempted = True
                    uow.commit()
                    commit_succeeded = True
            except Exception as exc:
                if commit_succeeded:
                    # SqlAlchemyUnitOfWork already makes this fail open. Keep
                    # the application-level guard because this service accepts
                    # the AbstractUnitOfWork port and another implementation
                    # may still surface post-commit context cleanup.
                    cleanup_error = exc
                elif (
                    commit_attempted
                    or not _is_retryable_postgres_exception(exc)
                    or attempt == _PG_RETRY_ATTEMPTS
                ):
                    raise
                else:
                    backoff = 2 ** (attempt - 1)
                    _log_postgres_retry(
                        batch_num=batch_num,
                        total_batches=total_batches,
                        attempt=attempt,
                        error=exc,
                        backoff=backoff,
                    )
                    time.sleep(backoff)
                    continue

            if cleanup_error is not None:
                _log_postgres_cleanup_failure(
                    batch_num=batch_num,
                    total_batches=total_batches,
                    inserted=batch_inserted,
                    updated=batch_updated,
                    error=cleanup_error,
                )

            return PostgresWriteStats(
                inserted=batch_inserted,
                updated=batch_updated,
            )

        # Unreachable: the loop returns on success or re-raises on the final
        # attempt. Present to satisfy type-checker exhaustiveness.
        raise RuntimeError("unreachable")

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

        for batch_num, total_batches, batch_seq in _iter_batches(
            activities, BQ_MAX_BATCH_SIZE
        ):
            batch = list(batch_seq)

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
