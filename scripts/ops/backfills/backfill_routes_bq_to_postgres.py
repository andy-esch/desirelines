#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "google-cloud-bigquery>=3.25",
#     "psycopg[binary]>=3.1",
#     "polyline>=2.0",
# ]
# ///
"""Backfill activity routes from BigQuery polylines to PostgreSQL activity_routes.

Reads encoded polylines from BigQuery's map.polyline column, decodes them to
GeoJSON LineStrings, and inserts into desirelines.activity_routes using
ST_GeomFromGeoJSON. Uses ON CONFLICT DO NOTHING for safe re-runs.

Usage:
    # Set connection string
    export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

    # Dry run (show what would be inserted)
    uv run scripts/ops/backfills/backfill_routes_bq_to_postgres.py --dry-run

    # Run backfill (defaults to desirelines-dev)
    uv run scripts/ops/backfills/backfill_routes_bq_to_postgres.py

    # Production
    uv run scripts/ops/backfills/backfill_routes_bq_to_postgres.py --project desirelines-prod
"""

import argparse
import json
import os
import sys

from google.cloud import bigquery
import polyline as polyline_codec
import psycopg


def decode_polyline_to_geojson(encoded: str) -> str | None:
    """Decode a Google encoded polyline to a GeoJSON LineString string.

    Returns None if the polyline decodes to fewer than 2 points
    (not a valid linestring) or if the polyline is invalid.

    Uses geojson=True to get (lng, lat) coordinate order directly.
    The returned string is ready for PostGIS ST_GeomFromGeoJSON().
    """
    if not encoded:
        return None
    try:
        coords = polyline_codec.decode(encoded, geojson=True)
    except (ValueError, IndexError):
        return None
    if len(coords) < 2:
        return None
    return json.dumps({"type": "LineString", "coordinates": coords})


def fetch_polylines_from_bigquery(
    project: str, dataset: str, table: str
) -> list[tuple[int, str]]:
    """Fetch activity IDs and polylines from BigQuery.

    Returns list of (activity_id, encoded_polyline) tuples.
    """
    client = bigquery.Client(project=project)

    query = f"""
    SELECT id, map.polyline
    FROM `{project}.{dataset}.{table}`
    WHERE map.polyline IS NOT NULL AND map.polyline != ''
    ORDER BY id
    """

    print(f"Querying BigQuery: {project}.{dataset}.{table}")
    rows = list(client.query(query).result())
    print(f"Fetched {len(rows)} activities with polylines")

    return [(row.id, row.polyline) for row in rows]


def insert_routes_to_postgres(
    conn_str: str,
    routes: list[tuple[int, str]],
    batch_size: int = 500,
    dry_run: bool = False,
) -> tuple[int, int]:
    """Decode polylines and insert into activity_routes.

    Returns (inserted_count, skipped_count).
    """
    if not routes:
        print("No routes to insert")
        return 0, 0

    # Decode all polylines first
    decoded: list[tuple[int, str]] = []
    decode_failures = 0

    for activity_id, encoded in routes:
        geojson = decode_polyline_to_geojson(encoded)
        if geojson is None:
            decode_failures += 1
            continue
        decoded.append((activity_id, geojson))

    print(f"Decoded {len(decoded)} routes ({decode_failures} failed to decode)")

    if dry_run:
        print(f"DRY RUN: Would insert {len(decoded)} routes")
        for activity_id, _ in decoded[:5]:
            print(f"  - activity {activity_id}")
        if len(decoded) > 5:
            print(f"  ... and {len(decoded) - 5} more")
        return 0, 0

    insert_sql = """
    INSERT INTO desirelines.activity_routes (activity_id, route)
    VALUES (%(activity_id)s, ST_GeomFromGeoJSON(%(geojson)s))
    ON CONFLICT (activity_id) DO NOTHING
    RETURNING activity_id
    """

    total_inserted = 0
    total_skipped = 0

    with psycopg.connect(conn_str) as conn, conn.cursor() as cur:
        for i in range(0, len(decoded), batch_size):
            batch = decoded[i : i + batch_size]
            batch_inserted = 0

            for activity_id, geojson in batch:
                cur.execute(
                    insert_sql,
                    {"activity_id": activity_id, "geojson": geojson},
                )
                if cur.fetchone() is not None:
                    batch_inserted += 1

            conn.commit()
            batch_skipped = len(batch) - batch_inserted
            total_inserted += batch_inserted
            total_skipped += batch_skipped
            print(
                f"Batch {i // batch_size + 1}: "
                f"{batch_inserted} inserted, {batch_skipped} skipped "
                f"(total: {total_inserted} inserted, {total_skipped} skipped)"
            )

    return total_inserted, total_skipped


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill activity routes from BigQuery polylines to PostgreSQL"
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

    conn_str = os.environ.get("POSTGRES_CONNECTION_STRING")
    if not conn_str and not args.dry_run:
        print("Error: POSTGRES_CONNECTION_STRING environment variable not set")
        print("Get it from Secret Manager:")
        print(
            "  export POSTGRES_CONNECTION_STRING=$(gcloud secrets versions access latest "
            "--secret=INFISICAL_POSTGRES_CONN_ADMIN --project=desirelines-dev)"
        )
        return 1

    # Fetch polylines from BigQuery
    routes = fetch_polylines_from_bigquery(
        project=args.project,
        dataset=args.dataset,
        table=args.table,
    )

    if not routes:
        print("No activities with polylines found in BigQuery")
        return 0

    # Insert into PostgreSQL
    print("\nInserting routes into PostgreSQL...")
    inserted, skipped = insert_routes_to_postgres(
        conn_str=conn_str or "",
        routes=routes,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
    )

    if not args.dry_run:
        print(
            f"\nDone! Inserted {inserted} routes, skipped {skipped} (already existed)"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
