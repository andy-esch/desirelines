#!/usr/bin/env python3
"""
Backfill production data from Strava API

Fetches activities from Strava (source of truth) and inserts to BigQuery
and PostgreSQL. Handles rate limiting and resumability.

This script uses Strava as the authoritative source, ensuring deleted activities
are properly excluded and all current activities are included.

Usage:
    # Dry run to preview activities
    python scripts/data/backfill_from_strava.py --years 2024 --dry-run

    # Backfill single year
    python scripts/data/backfill_from_strava.py --years 2024

    # Backfill multiple years
    python scripts/data/backfill_from_strava.py --years 2023 2024 2025

Environment Variables:
    # GCP
    export GCP_PROJECT_ID=desirelines-dev
    export BQ_DATASET=activities

    # Strava API
    export STRAVA_CLIENT_ID=12345
    export STRAVA_CLIENT_SECRET=abc123...
    export STRAVA_REFRESH_TOKEN=def456...

    # PostgreSQL (include application_name for observability)
    export POSTGRES_CONNECTION_STRING="postgres://writer:PASSWORD@HOST/desirelines?sslmode=require&application_name=postgres-writer"
"""

import argparse
import logging
import sys
import time

from stravapipe.adapters.gcp import ActivitiesRepo, BigQueryClientWrapper
from stravapipe.adapters.postgres import SqlAlchemyUnitOfWork, create_session_factory
from stravapipe.adapters.strava import (
    DetailedStravaActivitiesRepo,
    StravaApiConfig,
    StravaTokenRepo,
)
from stravapipe.config.bq_inserter import load_bq_inserter_config
from stravapipe.config.postgres_writer import load_postgres_writer_config
from stravapipe.domain import StandardActivity, SummaryStravaActivity

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

BATCH_SIZE = 100


class StravaBackfiller:
    """Handles backfilling activities from Strava API to BigQuery and PostgreSQL"""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self._bq_config = None  # Lazy loaded
        self._pg_config = None  # Lazy loaded
        self._strava_repo: DetailedStravaActivitiesRepo | None = None
        self._bq_repo: ActivitiesRepo | None = None
        self._pg_session_factory = None  # Lazy loaded

    def _get_bq_config(self):
        """Lazy load BigQuery configuration"""
        if self._bq_config is None:
            logger.info("Loading BigQuery configuration from environment...")
            self._bq_config = load_bq_inserter_config()
        return self._bq_config

    def _get_pg_config(self):
        """Lazy load PostgreSQL configuration"""
        if self._pg_config is None:
            logger.info("Loading PostgreSQL configuration from environment...")
            self._pg_config = load_postgres_writer_config()
        return self._pg_config

    def _initialize_strava_repo(self) -> DetailedStravaActivitiesRepo:
        """Lazy initialize Strava repository with token refresh"""
        if self._strava_repo is None:
            logger.info("Initializing Strava API client...")
            config = self._get_bq_config()

            # Refresh the access token before making API calls
            # The token repo handles OAuth refresh flow with the refresh token
            logger.info("Refreshing Strava access token...")
            token_repo = StravaTokenRepo(config.tokens, StravaApiConfig())
            refreshed_tokens = token_repo.refresh()

            # Create activities repo with the refreshed tokens
            self._strava_repo = DetailedStravaActivitiesRepo(
                tokens=refreshed_tokens, api_config=StravaApiConfig()
            )
            logger.info("Strava API client initialized with fresh access token")
        return self._strava_repo

    def _initialize_bq_repo(self) -> ActivitiesRepo:
        """Lazy initialize BigQuery repository"""
        if self._bq_repo is None:
            logger.info("Initializing BigQuery client...")
            config = self._get_bq_config()
            client = BigQueryClientWrapper(project_id=config.project_id)
            self._bq_repo = ActivitiesRepo(
                client=client, dataset_name=config.bq_dataset
            )
        return self._bq_repo

    def _initialize_postgres(self):
        """Lazy initialize PostgreSQL session factory"""
        if self._pg_session_factory is None:
            logger.info("Initializing PostgreSQL client...")
            config = self._get_pg_config()
            self._pg_session_factory = create_session_factory(
                config.postgres_connection_string
            )
            logger.info("PostgreSQL session factory initialized")
        return self._pg_session_factory

    def fetch_activities_for_year(self, year: int) -> list[SummaryStravaActivity]:
        """
        Fetch all activities for a given year from Strava API

        Args:
            year: The year to fetch activities for

        Returns:
            List of SummaryStravaActivity objects (from list endpoint)

        Note:
            - Uses Strava API pagination (100 activities per request)
            - Returns SummaryActivity (missing some fields like segments, splits)
            - Respects Strava rate limits (handled by repository)
            - Only returns current activities (deleted activities excluded)
        """
        logger.info(f"Fetching activities from Strava for {year}...")
        strava_repo = self._initialize_strava_repo()

        try:
            activities = strava_repo.read_activities_by_year(year)
            logger.info(f"Found {len(activities)} activities in {year}")
            return activities
        except Exception as e:
            logger.error(f"Failed to fetch activities for {year}: {e}")
            raise

    def insert_activities_to_bigquery(
        self, activities: list[SummaryStravaActivity]
    ) -> tuple[int, int, int]:
        """
        Insert activities to BigQuery using batch insertion

        Args:
            activities: List of activities to insert (SummaryActivity from list endpoint)

        Returns:
            Tuple of (inserted_count, skipped_count, error_count)

        Note:
            - Uses batch insertion (write_activities_batch) for efficiency
            - BigQuery supports up to 10,000 rows per batch, we use chunks of 100
            - Missing fields (segments, splits, etc.) will be NULL in BigQuery
        """
        if self.dry_run:
            logger.info("DRY RUN - would insert to BigQuery:")
            for i, act in enumerate(activities[:10], 1):
                logger.info(f"  {i}. Activity {act.id} - {act.name} ({act.start_date})")
            if len(activities) > 10:
                logger.info(f"  ... and {len(activities) - 10} more")
            return (len(activities), 0, 0)

        logger.info(f"Inserting {len(activities)} activities to BigQuery in batches...")
        bq_repo = self._initialize_bq_repo()

        inserted_count = 0
        skipped_count = 0
        error_count = 0

        # BigQuery insert_rows_json supports up to 10,000 rows per call
        # We'll use smaller chunks for better error handling and progress reporting
        total_batches = (len(activities) + BATCH_SIZE - 1) // BATCH_SIZE

        for batch_num, i in enumerate(range(0, len(activities), BATCH_SIZE), 1):
            batch = activities[i : i + BATCH_SIZE]

            try:
                result = bq_repo.write_activities_batch(batch)
                rows_affected = result.get("rows_affected", len(batch))
                inserted_count += rows_affected

                logger.info(
                    f"Batch {batch_num}/{total_batches}: {rows_affected} rows affected "
                    f"(total: {inserted_count}/{len(activities)})"
                )
            except Exception as e:
                error_msg = str(e).lower()
                if "already exists" in error_msg or "duplicate" in error_msg:
                    skipped_count += len(batch)
                    logger.debug(
                        f"Skipped batch {batch_num} (activities already exist)"
                    )
                else:
                    error_count += len(batch)
                    logger.error(f"Error inserting batch {batch_num}: {e}")

        logger.info(
            f"BigQuery insert complete: {inserted_count} inserted, "
            f"{skipped_count} skipped, {error_count} errors"
        )
        return (inserted_count, skipped_count, error_count)

    def insert_activities_to_postgres(
        self, activities: list[SummaryStravaActivity]
    ) -> tuple[int, int, int]:
        """
        Insert activities to PostgreSQL using batched transactions.

        Args:
            activities: List of activities to insert (SummaryActivity from list endpoint)

        Returns:
            Tuple of (inserted_count, skipped_count, error_count)

        Note:
            - Converts SummaryStravaActivity to StandardActivity for PostgreSQL schema
            - Uses Unit of Work pattern with batched commits
            - Handles duplicates gracefully (ON CONFLICT DO NOTHING)
        """
        if self.dry_run:
            logger.info("DRY RUN - would insert to PostgreSQL:")
            for i, act in enumerate(activities[:10], 1):
                logger.info(f"  {i}. Activity {act.id} - {act.name} ({act.start_date})")
            if len(activities) > 10:
                logger.info(f"  ... and {len(activities) - 10} more")
            return (len(activities), 0, 0)

        logger.info(
            f"Inserting {len(activities)} activities to PostgreSQL in batches..."
        )
        session_factory = self._initialize_postgres()

        inserted_count = 0
        skipped_count = 0
        error_count = 0

        total_batches = (len(activities) + BATCH_SIZE - 1) // BATCH_SIZE

        for batch_num, i in enumerate(range(0, len(activities), BATCH_SIZE), 1):
            batch = activities[i : i + BATCH_SIZE]

            try:
                batch_inserted = 0
                batch_skipped = 0

                with SqlAlchemyUnitOfWork(session_factory) as uow:
                    for activity in batch:
                        # Convert SummaryStravaActivity → StandardActivity
                        # StandardActivity uses extra="ignore" so we can parse from dict
                        standard = StandardActivity.model_validate(
                            activity.model_dump()
                        )

                        # Insert returns True if inserted, False if already existed
                        if uow.activities.insert(standard):
                            batch_inserted += 1
                        else:
                            batch_skipped += 1

                    uow.commit()

                inserted_count += batch_inserted
                skipped_count += batch_skipped

                logger.info(
                    f"Batch {batch_num}/{total_batches}: {batch_inserted} inserted, "
                    f"{batch_skipped} skipped (total: {inserted_count}/{len(activities)})"
                )
            except Exception as e:
                error_count += len(batch)
                logger.error(f"Error inserting batch {batch_num}: {e}")

        logger.info(
            f"PostgreSQL insert complete: {inserted_count} inserted, "
            f"{skipped_count} skipped, {error_count} errors"
        )
        return (inserted_count, skipped_count, error_count)

    def backfill_year(self, year: int) -> dict:
        """
        Backfill all data for a single year

        Args:
            year: The year to backfill

        Returns:
            Dictionary with backfill statistics

        Process:
            1. Fetch activities from Strava API (source of truth)
            2. Insert activities to BigQuery (skip duplicates)
            3. Insert activities to PostgreSQL (skip duplicates)
        """
        logger.info(f"{'=' * 60}")
        logger.info(f"Starting backfill for {year}")
        logger.info(f"{'=' * 60}")

        start_time = time.time()

        # Step 1: Fetch from Strava
        activities = self.fetch_activities_for_year(year)

        if not activities:
            logger.warning(f"No activities found for {year}, skipping")
            return {
                "year": year,
                "activities_found": 0,
                "bq_inserted": 0,
                "bq_skipped": 0,
                "bq_errors": 0,
                "pg_inserted": 0,
                "pg_skipped": 0,
                "pg_errors": 0,
                "duration_seconds": time.time() - start_time,
            }

        # Step 2: Insert to BigQuery
        bq_inserted, bq_skipped, bq_errors = self.insert_activities_to_bigquery(
            activities
        )

        # Step 3: Insert to PostgreSQL
        pg_inserted, pg_skipped, pg_errors = self.insert_activities_to_postgres(
            activities
        )

        duration = time.time() - start_time

        stats = {
            "year": year,
            "activities_found": len(activities),
            "bq_inserted": bq_inserted,
            "bq_skipped": bq_skipped,
            "bq_errors": bq_errors,
            "pg_inserted": pg_inserted,
            "pg_skipped": pg_skipped,
            "pg_errors": pg_errors,
            "duration_seconds": duration,
        }

        logger.info(
            f"Year {year} complete in {duration:.1f}s: "
            f"BQ({bq_inserted} inserted, {bq_skipped} skipped, {bq_errors} errors), "
            f"PG({pg_inserted} inserted, {pg_skipped} skipped, {pg_errors} errors)"
        )

        return stats


def main():
    """Main entry point for backfill script"""
    parser = argparse.ArgumentParser(
        description="Backfill production data from Strava API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run to preview activities
  %(prog)s --years 2024 --dry-run

  # Backfill single year
  %(prog)s --years 2024

  # Backfill multiple years
  %(prog)s --years 2023 2024 2025

  # Verbose logging
  %(prog)s --years 2024 --verbose
        """,
    )

    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        required=True,
        help="Years to backfill (e.g., 2023 2024 2025)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview activities without inserting to BigQuery or PostgreSQL",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="Enable verbose logging (DEBUG level)"
    )

    args = parser.parse_args()

    # Set log level
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Log configuration
    logger.info("Configuration:")
    logger.info(f"  Years: {args.years}")
    logger.info(f"  Dry run: {args.dry_run}")
    logger.info(f"  Verbose: {args.verbose}")
    logger.info("")

    # Initialize backfiller
    backfiller = StravaBackfiller(dry_run=args.dry_run)

    # Process each year
    all_stats = []
    total_bq_inserted = 0
    total_pg_inserted = 0
    total_errors = 0

    for year in sorted(args.years):
        try:
            stats = backfiller.backfill_year(year)
            all_stats.append(stats)
            total_bq_inserted += stats["bq_inserted"]
            total_pg_inserted += stats["pg_inserted"]
            total_errors += stats["bq_errors"] + stats["pg_errors"]
        except Exception as e:
            logger.error(f"Failed to backfill {year}: {e}")
            total_errors += 1
            # Continue with next year

    # Summary
    logger.info(f"{'=' * 60}")
    logger.info("Backfill Summary:")
    logger.info(f"{'=' * 60}")
    for stats in all_stats:
        logger.info(
            f"  {stats['year']}: "
            f"BQ({stats['bq_inserted']}/{stats['bq_skipped']}/{stats['bq_errors']}) "
            f"PG({stats['pg_inserted']}/{stats['pg_skipped']}/{stats['pg_errors']}) "
            f"({stats['duration_seconds']:.1f}s)"
        )
    logger.info(f"{'=' * 60}")
    logger.info(
        f"Total: BQ {total_bq_inserted} inserted, PG {total_pg_inserted} inserted, "
        f"{total_errors} errors"
    )

    if total_errors > 0:
        logger.warning(f"Completed with {total_errors} errors")
        sys.exit(1)
    else:
        logger.info("Backfill completed successfully!")
        sys.exit(0)


if __name__ == "__main__":
    main()
