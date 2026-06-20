#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "psycopg[binary]>=3.1",
# ]
# ///
"""Backfill desirelines.activity_regions for existing activity routes.

Tags every already-stored route with the region(s) it crosses, so the routes-map
feature works on historical data without waiting for new webhooks. Mirrors the
ingestion-time logic in the postgres-writer
(adapters/postgres/_repository.py::tag_activity_regions), but set-based over the
whole table in one pass:

  1. Specific tags — every non-fallback region a route's linestring intersects
     (``ST_Intersects``), across all boundary layers (county + CBSA). Virtual/
     indoor activities are excluded (trainer / manual / type LIKE 'Virtual%') —
     their geometry is fake/absent.
  2. ``earth`` fallback — routed non-virtual activities that matched no specific
     region get the builtin ``earth`` tag, so every geo-bearing activity has >=1
     region row.

Prerequisites: migrations V0005 + V0006 applied, and the regions table populated
(``load_census_regions.py``). Idempotent via ON CONFLICT DO NOTHING; ``--replace``
clears all existing tags first for a clean rebuild (e.g. after a regions reload).

Usage:
    export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

    uv run scripts/ops/backfills/backfill_route_regions.py --dry-run
    uv run scripts/ops/backfills/backfill_route_regions.py
    uv run scripts/ops/backfills/backfill_route_regions.py --replace
"""

import argparse
import os
import sys

import psycopg

# Non-geographic activities: their geometry is absent or fake (Zwift's polyline is
# a virtual world), so they must not be region-tagged. Checks both the granular
# `sport` (= Strava sport_type) and the legacy `type` — keep in sync with
# `_is_virtual` in cloudrun/postgres_writer_app.py.
_NON_VIRTUAL = (
    "NOT (a.trainer OR a.manual OR a.sport LIKE 'Virtual%' OR a.type LIKE 'Virtual%')"
)

_COUNT_CANDIDATES_SQL = f"""
    SELECT count(*)
    FROM desirelines.activity_routes ro
    JOIN desirelines.activities a ON a.id = ro.activity_id
    WHERE {_NON_VIRTUAL}
"""

_SPECIFIC_SQL = f"""
    INSERT INTO desirelines.activity_regions (activity_id, region_id)
    SELECT ro.activity_id, re.id
    FROM desirelines.activity_routes ro
    JOIN desirelines.activities a ON a.id = ro.activity_id
    JOIN desirelines.regions re ON ST_Intersects(ro.route, re.geom)
    WHERE re.region_kind <> 'global'
      AND {_NON_VIRTUAL}
    ON CONFLICT (activity_id, region_id) DO NOTHING
"""

_EARTH_FALLBACK_SQL = f"""
    INSERT INTO desirelines.activity_regions (activity_id, region_id)
    SELECT ro.activity_id, e.id
    FROM desirelines.activity_routes ro
    JOIN desirelines.activities a ON a.id = ro.activity_id
    CROSS JOIN (
        SELECT id FROM desirelines.regions
        WHERE source = 'builtin' AND region_code = 'earth'
    ) e
    WHERE {_NON_VIRTUAL}
      AND NOT EXISTS (
          SELECT 1 FROM desirelines.activity_regions ar
          WHERE ar.activity_id = ro.activity_id
      )
    ON CONFLICT (activity_id, region_id) DO NOTHING
"""


def backfill(conn_str: str, replace: bool, dry_run: bool) -> None:
    """Tag all existing routes with their regions in a single transaction."""
    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.execute(_COUNT_CANDIDATES_SQL)
            candidates = cur.fetchone()[0]
            print(f"Routed, non-virtual activities to tag: {candidates}")

            if dry_run:
                print("DRY RUN: no rows written.")
                conn.rollback()
                return

            if replace:
                cur.execute("DELETE FROM desirelines.activity_regions")
                print(f"  Replaced: cleared {cur.rowcount} existing tag rows")

            cur.execute(_SPECIFIC_SQL)
            specific = cur.rowcount
            print(f"  Specific-region tags written: {specific}")

            cur.execute(_EARTH_FALLBACK_SQL)
            earth = cur.rowcount
            print(f"  'earth' fallback tags written:  {earth}")

            conn.commit()  # atomic: replace + both inserts land together
            print(f"Done! {specific + earth} total region tags.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill activity_regions for existing routes"
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Clear all existing activity_regions rows first (clean rebuild)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report how many activities would be tagged, but write nothing",
    )
    args = parser.parse_args()

    conn_str = os.environ.get("POSTGRES_CONNECTION_STRING")
    if not conn_str:
        print("Error: POSTGRES_CONNECTION_STRING environment variable not set")
        print(
            "  export POSTGRES_CONNECTION_STRING=$(gcloud secrets versions access latest "
            "--secret=INFISICAL_POSTGRES_CONN_ADMIN --project=desirelines-dev)"
        )
        return 1

    backfill(conn_str=conn_str, replace=args.replace, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
