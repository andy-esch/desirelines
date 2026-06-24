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
whole table:

  1. Specific tags — every non-fallback region a route's linestring intersects
     (``ST_Intersects``), across all boundary layers (county + CBSA). Virtual/
     indoor activities are excluded (trainer / manual / type LIKE 'Virtual%') —
     their geometry is fake/absent.
  2. ``earth`` fallback — routed non-virtual activities that matched no specific
     region get the builtin ``earth`` tag, so every geo-bearing activity has >=1
     region row.

Safety (the table is shared by every user — see the 2026-06 ops review):

  * ``--replace`` is **scoped + batched**: tags are cleared and rebuilt per batch
    of activity ids, NOT via an unscoped ``DELETE FROM activity_regions`` (one
    wrong connection string used to wipe every user's tags in one statement).
  * ``--replace`` requires a typed ``yes`` confirmation (or ``--yes``) and echoes
    the target ``user@host:port/db`` before any write.
  * **Regions-loaded guard:** aborts if ``desirelines.regions`` holds fewer than
    ``MIN_SPECIFIC_REGIONS`` non-global rows. An empty/stale regions table makes
    the specific-tag join match nothing, silently tagging *every* activity
    ``earth`` — so we refuse rather than produce that. This also enforces the
    required ordering: run ``load_census_regions.py`` first.
  * **Batched + resumable:** processes candidates in ascending-id batches with a
    commit per batch, so a statement timeout / interrupt keeps prior progress and
    holds only short locks (the old single-transaction re-tag could deadlock the
    ingestion ``tag_activity_regions`` and lose everything on rollback). Re-run
    with ``--start-after <last id>`` to resume.

Idempotent via ON CONFLICT DO NOTHING. Prerequisites: migrations V0005 + V0006
applied, and the regions table populated (``load_census_regions.py``).

Usage:
    export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

    uv run scripts/ops/backfills/backfill_route_regions.py --dry-run
    uv run scripts/ops/backfills/backfill_route_regions.py
    uv run scripts/ops/backfills/backfill_route_regions.py --replace            # prompts
    uv run scripts/ops/backfills/backfill_route_regions.py --replace --yes       # CI/non-TTY
    uv run scripts/ops/backfills/backfill_route_regions.py --start-after 1234567 # resume
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

# Minimum non-global regions expected in desirelines.regions before a backfill is
# safe. The real census load is ~3,900 rows (county + CBSA); 100 is a deliberately
# low floor that still catches an empty/unloaded table (where the specific-tag join
# would match nothing and every activity would silently fall back to 'earth').
MIN_SPECIFIC_REGIONS = 100

# Default activities per committed batch. Small enough to hold only short locks on
# the spatial join; large enough to keep per-statement overhead low.
DEFAULT_BATCH_SIZE = 1000

_COUNT_SPECIFIC_REGIONS_SQL = """
    SELECT count(*) FROM desirelines.regions WHERE region_kind <> 'global'
"""

_COUNT_CANDIDATES_SQL = f"""
    SELECT count(*)
    FROM desirelines.activity_routes ro
    JOIN desirelines.activities a ON a.id = ro.activity_id
    WHERE {_NON_VIRTUAL}
"""

# Candidate activity ids (routed, non-virtual), keyset-paginated by id so the run
# batches with per-batch commits and is resumable.
_BATCH_IDS_SQL = f"""
    SELECT a.id
    FROM desirelines.activity_routes ro
    JOIN desirelines.activities a ON a.id = ro.activity_id
    WHERE {_NON_VIRTUAL}
      AND a.id > %(after)s
    ORDER BY a.id
    LIMIT %(batch)s
"""

# Scoped to the current batch's ids — never the whole table.
_DELETE_SCOPED_SQL = """
    DELETE FROM desirelines.activity_regions
    WHERE activity_id = ANY(%(ids)s)
"""

_SPECIFIC_SQL = f"""
    INSERT INTO desirelines.activity_regions (activity_id, region_id)
    SELECT ro.activity_id, re.id
    FROM desirelines.activity_routes ro
    JOIN desirelines.activities a ON a.id = ro.activity_id
    JOIN desirelines.regions re ON ST_Intersects(ro.route, re.geom)
    WHERE re.region_kind <> 'global'
      AND {_NON_VIRTUAL}
      AND ro.activity_id = ANY(%(ids)s)
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
      AND ro.activity_id = ANY(%(ids)s)
      AND NOT EXISTS (
          SELECT 1 FROM desirelines.activity_regions ar
          WHERE ar.activity_id = ro.activity_id
      )
    ON CONFLICT (activity_id, region_id) DO NOTHING
"""


def _describe_target(conn: psycopg.Connection) -> str:
    """A password-free ``user@host:port/db`` summary of the connection target."""
    info = conn.info
    return f"{info.user}@{info.host}:{info.port}/{info.dbname}"


def _confirm_replace(target: str, assume_yes: bool) -> bool:
    """Gate the destructive ``--replace`` behind a typed confirmation (or --yes)."""
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        print(
            "Refusing --replace without confirmation on a non-interactive stream. "
            "Re-run with --yes if you are certain.",
            file=sys.stderr,
        )
        return False
    print(f"--replace will CLEAR and rebuild region tags on: {target}")
    print("(scoped per batch to the routed activities it processes)")
    return input("Type 'yes' to proceed: ").strip().lower() == "yes"


def backfill(
    conn_str: str,
    *,
    replace: bool,
    dry_run: bool,
    assume_yes: bool,
    batch_size: int,
    limit: int | None,
    start_after: int,
) -> int:
    """Tag all existing routes with their regions, batched + committed per batch."""
    with psycopg.connect(conn_str) as conn:
        target = _describe_target(conn)
        print(f"Target: {target}")

        with conn.cursor() as cur:
            cur.execute(_COUNT_SPECIFIC_REGIONS_SQL)
            specific_regions = cur.fetchone()[0]
            if specific_regions < MIN_SPECIFIC_REGIONS:
                print(
                    f"ABORT: only {specific_regions} non-global regions in "
                    f"desirelines.regions (expected >= {MIN_SPECIFIC_REGIONS}). The "
                    "regions table looks empty/unloaded — every activity would fall "
                    "back to 'earth'. Run load_census_regions.py first.",
                    file=sys.stderr,
                )
                conn.rollback()
                return 1
            print(f"Specific (non-global) regions present: {specific_regions}")

            cur.execute(_COUNT_CANDIDATES_SQL)
            candidates = cur.fetchone()[0]
            print(f"Routed, non-virtual activities to tag: {candidates}")

        if dry_run:
            print("DRY RUN: no rows written.")
            conn.rollback()
            return 0

        if replace and not _confirm_replace(target, assume_yes):
            print("Aborted.", file=sys.stderr)
            conn.rollback()
            return 1

        total_specific = total_earth = processed = 0
        last_id = start_after
        with conn.cursor() as cur:
            while limit is None or processed < limit:
                cur.execute(_BATCH_IDS_SQL, {"after": last_id, "batch": batch_size})
                ids = [row[0] for row in cur.fetchall()]
                if not ids:
                    break
                if limit is not None and processed + len(ids) > limit:
                    ids = ids[: limit - processed]

                if replace:
                    cur.execute(_DELETE_SCOPED_SQL, {"ids": ids})
                cur.execute(_SPECIFIC_SQL, {"ids": ids})
                total_specific += cur.rowcount
                cur.execute(_EARTH_FALLBACK_SQL, {"ids": ids})
                total_earth += cur.rowcount
                conn.commit()  # per-batch: short locks + resumable progress

                processed += len(ids)
                last_id = ids[-1]
                print(
                    f"  …{processed}/{candidates} activities (through id {last_id}); "
                    f"+{total_specific} specific, +{total_earth} earth"
                )

        print(
            f"Done! Processed {processed} activities → "
            f"{total_specific + total_earth} region tags "
            f"({total_specific} specific, {total_earth} earth)."
        )
        if processed:
            print(f"(resume after id {last_id} with --start-after if interrupted)")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill activity_regions for existing routes"
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Clear and rebuild tags for the routed activities processed "
        "(scoped per batch — NOT an unscoped all-table delete). Requires "
        "confirmation; clears tags for ALL users' processed activities.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the --replace confirmation prompt (for CI / non-TTY runs)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report how many activities would be tagged, but write nothing",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Activities per committed batch (default {DEFAULT_BATCH_SIZE})",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after processing this many activities (smoke-testing)",
    )
    parser.add_argument(
        "--start-after",
        type=int,
        default=0,
        help="Resume: only process activities with id greater than this",
    )
    args = parser.parse_args()

    if args.batch_size < 1:
        print("Error: --batch-size must be >= 1", file=sys.stderr)
        return 1
    if args.limit is not None and args.limit < 1:
        print("Error: --limit must be >= 1", file=sys.stderr)
        return 1

    conn_str = os.environ.get("POSTGRES_CONNECTION_STRING")
    if not conn_str:
        print("Error: POSTGRES_CONNECTION_STRING environment variable not set")
        print(
            "  export POSTGRES_CONNECTION_STRING=$(gcloud secrets versions access latest "
            "--secret=INFISICAL_POSTGRES_CONN_ADMIN --project=desirelines-dev)"
        )
        return 1

    return backfill(
        conn_str=conn_str,
        replace=args.replace,
        dry_run=args.dry_run,
        assume_yes=args.yes,
        batch_size=args.batch_size,
        limit=args.limit,
        start_after=args.start_after,
    )


if __name__ == "__main__":
    sys.exit(main())
