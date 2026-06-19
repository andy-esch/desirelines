#!/usr/bin/env python3
"""Backfill activities from BigQuery to PostgreSQL.

This script reads activity data from BigQuery and inserts it into PostgreSQL.
It's a one-time migration tool for populating the PostgreSQL database with
historical data.

Usage:
    # Set connection string (get from Secret Manager or use env var)
    export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

    # Run backfill (defaults to desirelines-dev project)
    python scripts/ops/backfills/backfill_bq_to_postgres.py

    # Dry run (show what would be inserted)
    python scripts/ops/backfills/backfill_bq_to_postgres.py --dry-run

    # Specify different project
    python scripts/ops/backfills/backfill_bq_to_postgres.py --project desirelines-prod
"""

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import datetime

from google.cloud import bigquery
import psycopg


@dataclass
class Activity:
    """Activity data for PostgreSQL insert."""

    id: int
    user_id: str
    name: str | None
    type: str
    sport: str
    start_date_local: datetime
    year: int
    distance: float
    moving_time: int
    elapsed_time: int
    total_elevation_gain: float | None
    average_speed: float | None
    max_speed: float | None
    average_heartrate: float | None
    max_heartrate: float | None
    trainer: bool
    manual: bool


def fetch_activities_from_bigquery(
    project: str, dataset: str, table: str
) -> list[Activity]:
    """Fetch all activities from BigQuery."""
    client = bigquery.Client(project=project)

    query = f"""
    SELECT
        id,
        athlete.id as athlete_id,
        name,
        type,
        sport_type,
        start_date_local,
        distance,
        moving_time,
        elapsed_time,
        total_elevation_gain,
        average_speed,
        max_speed,
        average_heartrate,
        max_heartrate,
        COALESCE(trainer, FALSE) AS trainer,
        COALESCE(manual, FALSE) AS manual
    FROM `{project}.{dataset}.{table}`
    ORDER BY start_date_local DESC
    """

    print(f"Querying BigQuery: {project}.{dataset}.{table}")
    query_job = client.query(query)
    rows = list(query_job.result())
    print(f"Fetched {len(rows)} activities from BigQuery")

    activities = []
    for row in rows:
        start_date_local = row.start_date_local
        activities.append(
            Activity(
                id=row.id,
                user_id=str(row.athlete_id),
                name=row.name,
                type=row.type,
                sport=row.sport_type,
                start_date_local=start_date_local,
                year=start_date_local.year,
                distance=row.distance,
                moving_time=row.moving_time,
                elapsed_time=row.elapsed_time,
                total_elevation_gain=row.total_elevation_gain,
                average_speed=row.average_speed,
                max_speed=row.max_speed,
                average_heartrate=row.average_heartrate,
                max_heartrate=row.max_heartrate,
                trainer=row.trainer,
                manual=row.manual,
            )
        )

    return activities


def insert_activities_to_postgres(
    conn_str: str,
    activities: list[Activity],
    batch_size: int = 500,
    dry_run: bool = False,
) -> int:
    """Insert activities into PostgreSQL using upsert.

    Returns the number of rows inserted/updated.
    """
    if not activities:
        print("No activities to insert")
        return 0

    if dry_run:
        print(f"DRY RUN: Would insert {len(activities)} activities")
        # Show sample of what would be inserted
        for activity in activities[:5]:
            print(
                f"  - {activity.id}: {activity.name} ({activity.sport}, {activity.start_date_local.date()})"
            )
        if len(activities) > 5:
            print(f"  ... and {len(activities) - 5} more")
        return 0

    upsert_sql = """
    INSERT INTO desirelines.activities (
        id, user_id, name, type, sport, start_date_local, year,
        distance, moving_time, elapsed_time, total_elevation_gain,
        average_speed, max_speed, average_heartrate, max_heartrate,
        trainer, manual,
        updated_at
    ) VALUES (
        %(id)s, %(user_id)s, %(name)s, %(type)s, %(sport)s, %(start_date_local)s, %(year)s,
        %(distance)s, %(moving_time)s, %(elapsed_time)s, %(total_elevation_gain)s,
        %(average_speed)s, %(max_speed)s, %(average_heartrate)s, %(max_heartrate)s,
        %(trainer)s, %(manual)s,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        sport = EXCLUDED.sport,
        start_date_local = EXCLUDED.start_date_local,
        year = EXCLUDED.year,
        distance = EXCLUDED.distance,
        moving_time = EXCLUDED.moving_time,
        elapsed_time = EXCLUDED.elapsed_time,
        total_elevation_gain = EXCLUDED.total_elevation_gain,
        average_speed = EXCLUDED.average_speed,
        max_speed = EXCLUDED.max_speed,
        average_heartrate = EXCLUDED.average_heartrate,
        max_heartrate = EXCLUDED.max_heartrate,
        trainer = EXCLUDED.trainer,
        manual = EXCLUDED.manual,
        updated_at = CURRENT_TIMESTAMP
    """

    total_inserted = 0

    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            # Process in batches
            for i in range(0, len(activities), batch_size):
                batch = activities[i : i + batch_size]

                for activity in batch:
                    cur.execute(
                        upsert_sql,
                        {
                            "id": activity.id,
                            "user_id": activity.user_id,
                            "name": activity.name,
                            "type": activity.type,
                            "sport": activity.sport,
                            "start_date_local": activity.start_date_local,
                            "year": activity.year,
                            "distance": activity.distance,
                            "moving_time": activity.moving_time,
                            "elapsed_time": activity.elapsed_time,
                            "total_elevation_gain": activity.total_elevation_gain,
                            "average_speed": activity.average_speed,
                            "max_speed": activity.max_speed,
                            "average_heartrate": activity.average_heartrate,
                            "max_heartrate": activity.max_heartrate,
                            "trainer": activity.trainer,
                            "manual": activity.manual,
                        },
                    )

                conn.commit()
                total_inserted += len(batch)
                print(
                    f"Inserted batch {i // batch_size + 1}: {len(batch)} activities (total: {total_inserted})"
                )

    return total_inserted


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill activities from BigQuery to PostgreSQL"
    )
    parser.add_argument(
        "--project",
        default="desirelines-dev",
        help="GCP project ID (default: desirelines-dev)",
    )
    parser.add_argument(
        "--dataset",
        default="desirelines",
        help="BigQuery dataset (default: desirelines)",
    )
    parser.add_argument(
        "--table",
        default="activities",
        help="BigQuery table (default: activities)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Number of rows per batch (default: 500)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be inserted without actually inserting",
    )
    args = parser.parse_args()

    # Get PostgreSQL connection string
    conn_str = os.environ.get("POSTGRES_CONNECTION_STRING")
    if not conn_str:
        print("Error: POSTGRES_CONNECTION_STRING environment variable not set")
        print("Get it from Secret Manager (secrets managed by Infisical):")
        print(
            "  export POSTGRES_CONNECTION_STRING=$(gcloud secrets versions access latest --secret=INFISICAL_POSTGRES_CONN_ADMIN --project=desirelines-dev)"
        )
        return 1

    # Fetch from BigQuery
    activities = fetch_activities_from_bigquery(
        project=args.project,
        dataset=args.dataset,
        table=args.table,
    )

    if not activities:
        print("No activities found in BigQuery")
        return 0

    # Show sport distribution
    sport_counts: dict[str, int] = {}
    for activity in activities:
        sport_counts[activity.sport] = sport_counts.get(activity.sport, 0) + 1
    print("\nSport distribution:")
    for sport, count in sorted(sport_counts.items(), key=lambda x: -x[1]):
        print(f"  {sport}: {count}")

    # Insert into PostgreSQL
    print("\nInserting into PostgreSQL...")
    inserted = insert_activities_to_postgres(
        conn_str=conn_str,
        activities=activities,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
    )

    if not args.dry_run:
        print(f"\nDone! Inserted/updated {inserted} activities")

    return 0


if __name__ == "__main__":
    sys.exit(main())
