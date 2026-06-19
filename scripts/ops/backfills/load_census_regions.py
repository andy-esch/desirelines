#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "psycopg[binary]>=3.1",
#     "pyshp>=2.3",
# ]
# ///
"""Load US Census CBSA + county boundaries into desirelines.regions.

Populates the region-boundary reference table (V0005) that the routes-map
feature spatial-joins activity routes against. This is the US-only placeholder
dataset (a CBSA -> county cascade); the `regions` schema is source-agnostic so a
global dataset can be loaded the same way later.

Two Census cartographic boundary layers are loaded, both keyed by GEOID:
    - CBSA  (cb_<vintage>_us_cbsa_500k)   -> region_kind cbsa_metro / cbsa_micro
                                             (split on the LSAD attribute: M1=metro,
                                             M2=micropolitan; both live in one file)
    - county (cb_<vintage>_us_county_500k) -> region_kind county

Geometries are coerced to MULTIPOLYGON (ST_Multi) to match the column type;
ST_GeomFromGeoJSON yields SRID 4326. Re-runs are safe: each layer is loaded under
a `source` of `census_<layer>_<vintage>`, and `--replace` deletes that source's
existing rows first (ON DELETE SET NULL clears any route tags, which a re-tag
restores).

Usage:
    export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

    # Dry run (download + parse, report counts, insert nothing)
    uv run scripts/ops/backfills/load_census_regions.py --dry-run

    # Load 2023 vintage (default), skipping rows that already exist
    uv run scripts/ops/backfills/load_census_regions.py

    # Clean reload of both layers
    uv run scripts/ops/backfills/load_census_regions.py --replace

For the admin connection string in a cloud env:
    export POSTGRES_CONNECTION_STRING=$(gcloud secrets versions access latest \
        --secret=INFISICAL_POSTGRES_CONN_ADMIN --project=desirelines-dev)
"""

import argparse
import json
import os
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

import psycopg
import shapefile  # pyshp

CENSUS_BASE = "https://www2.census.gov/geo/tiger"

# LSAD attribute on the CBSA cartographic-boundary layer distinguishes the two
# CBSA types: "M1" = Metropolitan Statistical Area, "M2" = Micropolitan. (The
# TIGER MEMI field is not carried in the simplified cb_* boundary files.)
_LSAD_TO_KIND = {"M1": "cbsa_metro", "M2": "cbsa_micro"}


@dataclass
class Region:
    """One boundary row destined for desirelines.regions."""

    source: str
    region_code: str
    region_kind: str
    region_name: str
    geojson: str  # GeoJSON geometry string for ST_GeomFromGeoJSON


def _layer_url(vintage: int, layer: str) -> str:
    """Census cartographic-boundary (cb, 500k) shapefile zip URL for a layer."""
    return f"{CENSUS_BASE}/GENZ{vintage}/shp/cb_{vintage}_us_{layer}_500k.zip"


def _download_and_open(url: str, workdir: Path) -> shapefile.Reader:
    """Download a Census shapefile zip and open it with pyshp."""
    zip_path = workdir / Path(url).name
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, zip_path)  # noqa: S310 (fixed census.gov https URL)

    extract_dir = workdir / zip_path.stem
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(extract_dir)

    shp = next(extract_dir.glob("*.shp"), None)
    if shp is None:
        raise FileNotFoundError(f"No .shp found in {url}")
    return shapefile.Reader(str(shp))


def _field_getter(reader: shapefile.Reader):
    """Return a fn mapping a record to a dict keyed by uppercased field name."""
    # field[0] is the deletion flag; real fields start at index 1.
    names = [f[0].upper() for f in reader.fields[1:]]

    def get(record) -> dict[str, object]:
        # Values are mixed types (str names, int ALAND/AWATER); object is honest.
        return {name: value for name, value in zip(names, record)}

    return get


def parse_cbsa(reader: shapefile.Reader, vintage: int) -> list[Region]:
    """Parse the CBSA layer into metro/micropolitan regions."""
    source = f"census_cbsa_{vintage}"
    get = _field_getter(reader)
    regions: list[Region] = []
    skipped_lsad = 0

    for sr in reader.shapeRecords():
        rec = get(sr.record)
        kind = _LSAD_TO_KIND.get(str(rec.get("LSAD", "")).strip())
        if kind is None:
            skipped_lsad += 1
            continue
        regions.append(
            Region(
                source=source,
                region_code=rec["GEOID"],
                region_kind=kind,
                region_name=rec["NAME"],  # e.g. "Boston-Cambridge-Newton, MA-NH"
                geojson=json.dumps(sr.shape.__geo_interface__),
            )
        )

    if skipped_lsad:
        print(f"  CBSA: skipped {skipped_lsad} rows with unrecognized LSAD")
    return regions


def parse_county(reader: shapefile.Reader, vintage: int) -> list[Region]:
    """Parse the county layer into county regions."""
    source = f"census_county_{vintage}"
    get = _field_getter(reader)
    regions: list[Region] = []

    for sr in reader.shapeRecords():
        rec = get(sr.record)
        # NAMELSAD is "Middlesex County"; STUSPS gives the state abbreviation.
        state = rec.get("STUSPS", "")
        name = rec["NAMELSAD"]
        region_name = f"{name}, {state}" if state else name
        regions.append(
            Region(
                source=source,
                region_code=rec["GEOID"],
                region_kind="county",
                region_name=region_name,
                geojson=json.dumps(sr.shape.__geo_interface__),
            )
        )

    return regions


def load_regions(
    conn_str: str,
    regions: list[Region],
    sources: list[str],
    replace: bool,
    batch_size: int = 500,
) -> tuple[int, int]:
    """Insert regions into desirelines.regions. Returns (inserted, skipped).

    Runs as a single transaction (optional DELETE + all inserts), so a clean
    reload with --replace is atomic: a mid-load failure rolls back to the prior
    good state rather than leaving the table — and any route tags — half-cleared.
    """
    # ST_MakeValid + ST_CollectionExtract(.,3) keep only valid polygonal parts and
    # repair self-intersections before ST_Multi coerces to MULTIPOLYGON. Census
    # 2023 is already clean; this guards future vintages / the global dataset.
    insert_sql = """
    INSERT INTO desirelines.regions
        (source, region_code, region_kind, region_name, geom)
    VALUES
        (%(source)s, %(region_code)s, %(region_kind)s, %(region_name)s,
         ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(%(geojson)s)), 3)))
    ON CONFLICT (source, region_code) DO NOTHING
    RETURNING id
    """

    inserted = 0
    skipped = 0
    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            if replace:
                for source in sources:
                    cur.execute(
                        "DELETE FROM desirelines.regions WHERE source = %s",
                        (source,),
                    )
                    print(
                        f"  Replaced: deleted {cur.rowcount} existing rows for {source}"
                    )

            for i in range(0, len(regions), batch_size):
                batch = regions[i : i + batch_size]
                batch_inserted = 0
                for region in batch:
                    cur.execute(insert_sql, region.__dict__)
                    if cur.fetchone() is not None:
                        batch_inserted += 1
                inserted += batch_inserted
                skipped += len(batch) - batch_inserted
                # Progress only; the transaction commits once after the full load.
                print(
                    f"  Batch {i // batch_size + 1}: {batch_inserted} inserted "
                    f"(running: {inserted} inserted, {skipped} skipped)"
                )

            conn.commit()  # atomic: DELETE + every insert land together or not at all

    return inserted, skipped


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Load US Census CBSA + county boundaries into desirelines.regions"
    )
    parser.add_argument(
        "--vintage",
        type=int,
        default=2023,
        help="Census data vintage year (default: 2023)",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete each layer's existing rows before loading (clean reload)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Rows per insert batch (default: 500)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Download + parse and report counts, but insert nothing",
    )
    args = parser.parse_args()

    conn_str = os.environ.get("POSTGRES_CONNECTION_STRING")
    if not conn_str and not args.dry_run:
        print("Error: POSTGRES_CONNECTION_STRING environment variable not set")
        print(
            "  export POSTGRES_CONNECTION_STRING=$(gcloud secrets versions access latest \\"
        )
        print("      --secret=INFISICAL_POSTGRES_CONN_ADMIN --project=desirelines-dev)")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        cbsa_reader = _download_and_open(_layer_url(args.vintage, "cbsa"), workdir)
        county_reader = _download_and_open(_layer_url(args.vintage, "county"), workdir)

        cbsa_regions = parse_cbsa(cbsa_reader, args.vintage)
        county_regions = parse_county(county_reader, args.vintage)

    regions = cbsa_regions + county_regions
    metro = sum(1 for r in cbsa_regions if r.region_kind == "cbsa_metro")
    micro = sum(1 for r in cbsa_regions if r.region_kind == "cbsa_micro")
    print(
        f"Parsed {len(regions)} regions: {metro} cbsa_metro, {micro} cbsa_micro, "
        f"{len(county_regions)} county"
    )

    if args.dry_run:
        print("DRY RUN: inserting nothing. Sample:")
        for region in regions[:5]:
            print(f"  [{region.region_kind}] {region.region_code} {region.region_name}")
        return 0

    sources = [f"census_cbsa_{args.vintage}", f"census_county_{args.vintage}"]
    print("\nLoading into desirelines.regions...")
    inserted, skipped = load_regions(
        conn_str=conn_str or "",
        regions=regions,
        sources=sources,
        replace=args.replace,
        batch_size=args.batch_size,
    )
    print(f"\nDone! Inserted {inserted} regions, skipped {skipped} (already existed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
