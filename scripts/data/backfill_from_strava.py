#!/usr/bin/env python3
"""
Backfill production data from Strava API

Fetches activities from Strava (source of truth), inserts to BigQuery,
and generates aggregation files. Handles rate limiting and resumability.

This script uses Strava as the authoritative source, ensuring deleted activities
are properly excluded and all current activities are included.

Usage:
    # Dry run to preview activities
    python scripts/data/backfill_from_strava.py --years 2024 --dry-run

    # Backfill single year
    python scripts/data/backfill_from_strava.py --years 2024

    # Backfill multiple years
    python scripts/data/backfill_from_strava.py --years 2023 2024 2025

Requirements:
    - Strava API credentials configured in Secret Manager
    - BigQuery write permissions
    - Cloud Storage write permissions
    - Firestore write permissions (for aggregations)
"""

import argparse
import logging
import sys
import time

# Add stravapipe to path
# sys.path.insert(0, "packages/stravapipe/src")
from stravapipe.adapters.gcp import ActivitiesRepo, BigQueryClientWrapper
from stravapipe.adapters.strava import (
    DetailedStravaActivitiesRepo,
    StravaApiConfig,
    StravaTokenRepo,
)
from stravapipe.application.aggregator.usecases import make_update_summary_use_case
from stravapipe.config.aggregator import load_aggregator_config
from stravapipe.config.bq_inserter import load_bq_inserter_config
from stravapipe.domain import MinimalStravaActivity, SummaryStravaActivity

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class StravaBackfiller:
    """Handles backfilling activities from Strava API to production"""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self._config = None  # Lazy loaded
        self._strava_repo: DetailedStravaActivitiesRepo | None = None
        self._bq_repo: ActivitiesRepo | None = None

    def _get_config(self):
        """Lazy load configuration"""
        if self._config is None:
            logger.info("Loading configuration from environment...")
            self._config = load_bq_inserter_config()
        return self._config

    def _initialize_strava_repo(self) -> DetailedStravaActivitiesRepo:
        """Lazy initialize Strava repository with token refresh"""
        if self._strava_repo is None:
            logger.info("Initializing Strava API client...")
            config = self._get_config()

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
            config = self._get_config()
            client = BigQueryClientWrapper(project_id=config.project_id)
            self._bq_repo = ActivitiesRepo(
                client=client, dataset_name=config.bq_dataset
            )
        return self._bq_repo

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
        BATCH_SIZE = 100
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

    def generate_aggregations(
        self, year: int, activities: list[SummaryStravaActivity]
    ) -> None:
        """
        Generate aggregation files for a given year using already-fetched activities

        Args:
            year: The year to generate aggregations for
            activities: Activities already fetched from Strava (to avoid re-fetching)

        Note:
            Converts SummaryStravaActivity to MinimalStravaActivity (only needs 4 fields)
            and passes them to UpdateSummaryUseCase.run_batch() to avoid duplicate API calls.
        """
        if self.dry_run:
            logger.info(f"DRY RUN - would generate aggregations for {year}")
            return

        logger.info(f"Generating aggregation files for {year}...")

        try:
            # Convert SummaryStravaActivity → MinimalStravaActivity
            # Aggregator only needs: id, type, start_date_local, distance
            minimal_activities = [
                MinimalStravaActivity(
                    id=activity.id,
                    type=activity.type,
                    start_date_local=activity.start_date_local,
                    distance=activity.distance,
                )
                for activity in activities
            ]

            logger.info(
                f"Converted {len(minimal_activities)} activities to minimal format"
            )

            # Load aggregator config (needs GCP bucket for storage)
            aggregator_config = load_aggregator_config()

            # Create use case with all dependencies wired up
            update_summary_use_case = make_update_summary_use_case(aggregator_config)

            # Run batch aggregation with pre-fetched activities (avoids re-fetching)
            update_summary_use_case.run_batch(year, activities=minimal_activities)

            logger.info(f"Aggregation complete for {year}")
        except Exception as e:
            logger.error(f"Failed to generate aggregations for {year}: {e}")
            raise

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
            3. Generate aggregation files for the year
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
                "inserted": 0,
                "skipped": 0,
                "errors": 0,
                "duration_seconds": time.time() - start_time,
            }

        # Step 2: Insert to BigQuery
        inserted, skipped, errors = self.insert_activities_to_bigquery(activities)

        # Step 3: Generate aggregations (pass activities to avoid re-fetching)
        self.generate_aggregations(year, activities)

        duration = time.time() - start_time

        stats = {
            "year": year,
            "activities_found": len(activities),
            "inserted": inserted,
            "skipped": skipped,
            "errors": errors,
            "duration_seconds": duration,
        }

        logger.info(
            f"Year {year} complete in {duration:.1f}s: "
            f"{inserted} inserted, {skipped} skipped, {errors} errors"
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
        help="Preview activities without inserting to BigQuery or generating aggregations",
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
    total_inserted = 0
    total_errors = 0

    for year in sorted(args.years):
        try:
            stats = backfiller.backfill_year(year)
            all_stats.append(stats)
            total_inserted += stats["inserted"]
            total_errors += stats["errors"]
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
            f"  {stats['year']}: {stats['inserted']} inserted, "
            f"{stats['skipped']} skipped, {stats['errors']} errors "
            f"({stats['duration_seconds']:.1f}s)"
        )
    logger.info(f"{'=' * 60}")
    logger.info(f"Total: {total_inserted} activities inserted, {total_errors} errors")

    if total_errors > 0:
        logger.warning(f"Completed with {total_errors} errors")
        sys.exit(1)
    else:
        logger.info("Backfill completed successfully!")
        sys.exit(0)


if __name__ == "__main__":
    main()
