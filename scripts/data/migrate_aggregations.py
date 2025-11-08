#!/usr/bin/env python3
"""
Migrate existing aggregation data to multi-sport format

Reads activities from BigQuery (source of truth) and regenerates aggregations
in the new multi-sport format using the updated aggregator from Task 3.

This script:
1. Queries BigQuery for all activities in specified years
2. Converts to MinimalStravaActivity format
3. Calls run_batch() to generate multi-sport aggregations
4. Does NOT hit Strava API (uses existing BigQuery data)

Usage:
    # Dry run to see what would be processed
    python scripts/data/migrate_aggregations.py --years 2024 --dry-run

    # Migrate single year
    python scripts/data/migrate_aggregations.py --years 2024

    # Migrate multiple years
    python scripts/data/migrate_aggregations.py --years 2023 2024 2025

Requirements:
    - BigQuery read permissions
    - Cloud Storage write permissions
    - Aggregator deployed/updated (Task 3 complete)
"""

import argparse
import logging
import os
import sys
import time

from google.cloud import bigquery

from stravapipe.adapters.gcp import make_read_summaries
from stravapipe.application.aggregator.services import (
    make_export_service,
    make_pacing_service,
)
from stravapipe.application.aggregator.usecases.update_summary import (
    UpdateSummaryUseCase,
)
from stravapipe.config.aggregator import AggregatorConfig
from stravapipe.domain import MinimalStravaActivity

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class StubTokenRepo:
    """Stub token repository for migration (no Strava API calls needed)"""

    def refresh(self):
        """Return stub tokens - not used when passing activities directly"""
        return type(
            "StubTokens",
            (),
            {
                "access_token": "not-used",
                "refresh_token": "not-used",
                "expires_at": 0,
            },
        )()


class AggregationMigrator:
    """Migrates aggregations from cycling-only to multi-sport format"""

    def __init__(self, project_id: str, dry_run: bool = False):
        self.project_id = project_id
        self.dry_run = dry_run
        self._bq_client = None
        self._aggregator_config = None

    def _get_bq_client(self) -> bigquery.Client:
        """Lazy load BigQuery client"""
        if self._bq_client is None:
            logger.info(f"Initializing BigQuery client for project {self.project_id}")
            self._bq_client = bigquery.Client(project=self.project_id)
        return self._bq_client

    def _get_aggregator_config(self):
        """Lazy load aggregator configuration

        Creates minimal config needed for migration. Strava credentials are required
        by the config schema but won't be used since we pass activities directly.
        """
        if self._aggregator_config is None:
            logger.info("Creating aggregator configuration...")

            # Determine bucket name from project ID
            # Format: desirelines-{env}-desirelines-aggregation
            if "dev" in self.project_id:
                bucket_name = "desirelines-dev-desirelines-aggregation"
            elif "prod" in self.project_id:
                bucket_name = "desirelines-prod-desirelines-aggregation"
            else:
                raise ValueError(
                    f"Cannot determine bucket name from project ID: {self.project_id}. "
                    "Expected 'desirelines-dev' or 'desirelines-prod'"
                )

            # Create minimal config
            # Strava credentials are required by schema but won't be used
            # (we pass activities directly to run_batch, no API calls)
            self._aggregator_config = AggregatorConfig(
                gcp_project_id=self.project_id,
                gcp_bucket_name=bucket_name,
                strava_client_id=0,  # Not used - we pass activities directly
                strava_client_secret="not-used",  # Not used - we pass activities directly
                strava_refresh_token="not-used",  # Not used - we pass activities directly
            )

            logger.info(f"  Project: {self.project_id}")
            logger.info(f"  Bucket: {bucket_name}")

        return self._aggregator_config

    def fetch_activities_from_bigquery(self, year: int) -> list[MinimalStravaActivity]:
        """
        Fetch all activities for a year from BigQuery

        Args:
            year: The year to fetch activities for

        Returns:
            List of MinimalStravaActivity objects (only fields needed for aggregation)

        Note:
            - Reads from BigQuery (no Strava API calls)
            - Returns minimal data: id, type, start_date_local, distance
            - Filters are applied by aggregator (not here)
        """
        logger.info(f"Fetching activities from BigQuery for {year}...")
        client = self._get_bq_client()

        query = f"""
        SELECT
            id,
            type,
            start_date_local,
            distance,
            moving_time,
            total_elevation_gain
        FROM `{self.project_id}.desirelines.activities`
        WHERE EXTRACT(YEAR FROM start_date_local) = @year
        ORDER BY start_date_local
        """

        job_config = bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("year", "INT64", year)]
        )

        try:
            query_job = client.query(query, job_config=job_config)
            results = query_job.result()

            activities = []
            for row in results:
                # BigQuery stores distance in meters (Strava standard)
                # MinimalStravaActivity expects meters
                activity = MinimalStravaActivity(
                    id=row.id,
                    type=row.type,
                    start_date_local=row.start_date_local,
                    distance=row.distance,  # Already in meters from BigQuery
                    moving_time=row.moving_time,  # In seconds
                    total_elevation_gain=row.total_elevation_gain,  # In meters
                )
                activities.append(activity)

            logger.info(f"Found {len(activities)} activities in {year}")
            return activities

        except Exception as e:
            logger.error(f"Failed to fetch activities for {year}: {e}")
            raise

    def generate_aggregations(
        self, year: int, activities: list[MinimalStravaActivity]
    ) -> None:
        """
        Generate multi-sport aggregation files for a year

        Args:
            year: The year to generate aggregations for
            activities: Activities fetched from BigQuery

        Note:
            - Uses UpdateSummaryUseCase.run_batch() from Task 3
            - Aggregator handles sport categorization
            - Writes new multi-sport format (metadata.json, metrics/, source/)
        """
        if self.dry_run:
            logger.info(f"DRY RUN - would generate aggregations for {year}")
            logger.info(f"  Activities to process: {len(activities)}")
            # Show sport breakdown
            sport_counts = {}
            for activity in activities:
                sport_counts[activity.type] = sport_counts.get(activity.type, 0) + 1
            logger.info("  Sport breakdown:")
            for sport, count in sorted(sport_counts.items()):
                logger.info(f"    {sport}: {count}")
            return

        logger.info(f"Generating aggregation files for {year}...")

        try:
            # Load aggregator config
            aggregator_config = self._get_aggregator_config()

            # Create use case with minimal dependencies
            # We only need pacing and export services (not Strava API)
            # Use stub token repo since we pass activities directly (no API calls)
            update_summary_use_case = UpdateSummaryUseCase(
                read_activities=lambda tokens: None,  # Not used when passing activities
                read_summaries=lambda: make_read_summaries(aggregator_config),
                read_strava_token=lambda: StubTokenRepo(),  # Returns stub tokens
                pacing_service=make_pacing_service,
                export_service=lambda: make_export_service(aggregator_config),
            )

            # Run batch aggregation (writes multi-sport format)
            # The aggregator from Task 3 now writes:
            #   - activities/YYYY/metadata.json
            #   - activities/YYYY/metrics/cycling.json
            #   - activities/YYYY/source/cycling.json
            logger.info(f"Calling run_batch with {len(activities)} activities...")
            update_summary_use_case.run_batch(year, activities=activities)

            logger.info(f"✅ Aggregation complete for {year}")
            logger.info(f"   Files should be in: gs://{aggregator_config.gcp_bucket_name}/activities/{year}/")

        except Exception as e:
            logger.error(f"Failed to generate aggregations for {year}: {e}")
            raise

    def migrate_year(self, year: int) -> dict:
        """
        Migrate aggregations for a single year

        Args:
            year: The year to migrate

        Returns:
            Dictionary with migration statistics

        Process:
            1. Fetch activities from BigQuery (no Strava API calls)
            2. Generate multi-sport aggregations using updated aggregator
        """
        logger.info(f"{'=' * 60}")
        logger.info(f"Starting migration for {year}")
        logger.info(f"{'=' * 60}")

        start_time = time.time()

        # Step 1: Fetch from BigQuery
        activities = self.fetch_activities_from_bigquery(year)

        if not activities:
            logger.warning(f"No activities found for {year}, skipping")
            return {
                "year": year,
                "activities_found": 0,
                "duration_seconds": time.time() - start_time,
            }

        # Step 2: Generate multi-sport aggregations
        self.generate_aggregations(year, activities)

        duration = time.time() - start_time

        stats = {
            "year": year,
            "activities_found": len(activities),
            "duration_seconds": duration,
        }

        logger.info(f"Year {year} complete in {duration:.1f}s")

        return stats


def main():
    """Main entry point for migration script"""
    parser = argparse.ArgumentParser(
        description="Migrate aggregation data to multi-sport format",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run to preview migration
  %(prog)s --years 2024 --dry-run

  # Migrate single year (dev)
  %(prog)s --project desirelines-dev --years 2024

  # Migrate multiple years (prod)
  %(prog)s --project desirelines-prod --years 2023 2024 2025

  # Verbose logging
  %(prog)s --years 2024 --verbose
        """,
    )

    parser.add_argument(
        "--project",
        type=str,
        help="GCP project ID (e.g., desirelines-dev, desirelines-prod). "
        "If not specified, uses gcloud default project.",
    )
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        required=True,
        help="Years to migrate (e.g., 2023 2024 2025)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview migration without generating aggregations",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="Enable verbose logging (DEBUG level)"
    )

    args = parser.parse_args()

    # Set log level
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Get project ID
    if args.project:
        project_id = args.project
    else:
        # Try to get from gcloud config
        import subprocess

        try:
            result = subprocess.run(
                ["gcloud", "config", "get-value", "project"],
                capture_output=True,
                text=True,
                check=True,
            )
            project_id = result.stdout.strip()
            if not project_id:
                logger.error("No project specified and gcloud default project not set")
                logger.error(
                    "Use --project or run: gcloud config set project PROJECT_ID"
                )
                sys.exit(1)
        except subprocess.CalledProcessError:
            logger.error("Failed to get gcloud default project")
            logger.error("Use --project or run: gcloud config set project PROJECT_ID")
            sys.exit(1)

    # Log configuration
    logger.info("Configuration:")
    logger.info(f"  Project: {project_id}")
    logger.info(f"  Years: {args.years}")
    logger.info(f"  Dry run: {args.dry_run}")
    logger.info(f"  Verbose: {args.verbose}")
    logger.info("")

    # Initialize migrator
    migrator = AggregationMigrator(project_id=project_id, dry_run=args.dry_run)

    # Process each year
    all_stats = []
    total_activities = 0
    total_errors = 0

    for year in sorted(args.years):
        try:
            stats = migrator.migrate_year(year)
            all_stats.append(stats)
            total_activities += stats["activities_found"]
        except Exception as e:
            logger.error(f"Failed to migrate {year}: {e}")
            total_errors += 1
            # Continue with next year

    # Summary
    logger.info(f"{'=' * 60}")
    logger.info("Migration Summary:")
    logger.info(f"{'=' * 60}")
    for stats in all_stats:
        logger.info(
            f"  {stats['year']}: {stats['activities_found']} activities "
            f"({stats['duration_seconds']:.1f}s)"
        )
    logger.info(f"{'=' * 60}")
    logger.info(
        f"Total: {total_activities} activities processed, {total_errors} errors"
    )

    if total_errors > 0:
        logger.warning(f"Completed with {total_errors} errors")
        sys.exit(1)
    else:
        logger.info("✅ Migration completed successfully!")
        sys.exit(0)


if __name__ == "__main__":
    main()
