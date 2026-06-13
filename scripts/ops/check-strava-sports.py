#!/usr/bin/env python3
"""Diff Strava's upstream SportType enum against our local sport registry.

Strava periodically adds new `sport_type` enum values to their API (e.g.,
``HighIntensityIntervalTraining`` was added some time after the original
``HIIT``). When that happens, we want to know *before* a user's webhook
arrives and gets bucketed into "other" so we can map the new value into the
right category in ``schemas/sports/sport_types.json``.

This script:
  1. Downloads Strava's Swagger spec from a configurable URL (default:
     https://developers.strava.com/swagger/swagger.json).
  2. Extracts the ``SportType`` enum values.
  3. Compares them against the union of ``stravaTypes`` and
     ``excludedTypes`` in ``schemas/sports/sport_types.json``.
  4. Prints any sports that are in Strava but not in our registry.

Exit codes:
  * ``0`` — registry is in sync (no missing sports); OR drift was detected
    and the script was invoked without ``--strict``; OR an upstream
    fetch/parse failure occurred and ``--allow-fetch-failure`` was passed.
  * ``1`` — drift detected and ``--strict`` was passed. Use this in CI to
    fail the build.
  * ``2`` — operational failure (network error, malformed swagger, or an
    unreadable local registry). Pass ``--allow-fetch-failure`` to downgrade
    the *upstream* (fetch/parse) failures to exit 0 so a scheduled CI job
    only reds on real drift, not on a transient Strava outage; a local
    registry error always exits 2.

Usage:
    python3 scripts/ops/check-strava-sports.py            # warn-only mode
    python3 scripts/ops/check-strava-sports.py --strict   # CI-friendly mode
    python3 scripts/ops/check-strava-sports.py --strict --allow-fetch-failure  # scheduled CI: fail only on drift
    python3 scripts/ops/check-strava-sports.py --swagger-url <url>

Stdlib only — no dependencies. Runs under any Python 3.11+ on PATH so the
recipe and any CI job that wires it up don't need ``uv``.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request

DEFAULT_SWAGGER_URL = "https://developers.strava.com/swagger/swagger.json"
DEFAULT_REGISTRY_PATH = (
    Path(__file__).resolve().parents[2] / "schemas" / "sports" / "sport_types.json"
)
DEFAULT_TIMEOUT_SECONDS = 15


def fetch_swagger(url: str, timeout: int) -> dict[str, Any]:
    """Download and parse the Strava Swagger document."""
    req = urllib.request.Request(
        url, headers={"User-Agent": "desirelines-sport-sync/1.0"}
    )
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected -
    # URL is configurable but defaults to Strava's well-known docs endpoint;
    # only consumed by this offline tooling.
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        if resp.status != 200:
            raise RuntimeError(f"swagger fetch returned HTTP {resp.status}")
        return json.loads(resp.read().decode("utf-8"))


def extract_strava_sport_types(swagger: dict[str, Any]) -> set[str]:
    """Pull the SportType enum out of a Swagger 2.0 definitions block.

    Strava publishes Swagger 2.0 (not OpenAPI 3.x), so the path is
    ``definitions.SportType.enum`` rather than ``components.schemas...``.
    Defends against schema reshuffle by also walking
    ``components.schemas`` as a fallback.
    """
    definitions = swagger.get("definitions") or {}
    sport = definitions.get("SportType") or {}
    enum = sport.get("enum")
    if enum:
        return {str(v) for v in enum}

    # OpenAPI 3.x fallback in case Strava migrates the spec.
    components = swagger.get("components") or {}
    schemas = components.get("schemas") or {}
    sport = schemas.get("SportType") or {}
    enum = sport.get("enum")
    if enum:
        return {str(v) for v in enum}

    raise RuntimeError(
        "SportType enum not found in swagger. Strava may have restructured "
        "their docs — inspect the JSON manually and update this script."
    )


def load_registry_types(registry_path: Path) -> set[str]:
    """Union of every sport_type declared in our local registry.

    Includes ``excludedTypes`` so that e.g. ``EBikeRide`` (which lives under
    cycling's excluded list but is the primary type for the ebike category)
    is treated as "known", not flagged as missing. Strips the internal
    sentinel value used to satisfy the ``stravaTypes min=1`` validator on
    the "other" catch-all category — that sentinel is never a real Strava
    sport_type.
    """
    with registry_path.open() as f:
        data = json.load(f)

    seen: set[str] = set()
    for category in data.get("sportCategories", {}).values():
        for key in ("stravaTypes", "excludedTypes"):
            for value in category.get(key, []):
                seen.add(value)
    seen.discard("__unmapped_sport_type__")
    return seen


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--swagger-url",
        default=DEFAULT_SWAGGER_URL,
        help="Strava swagger.json URL (default: %(default)s)",
    )
    parser.add_argument(
        "--registry",
        type=Path,
        default=DEFAULT_REGISTRY_PATH,
        help="Path to schemas/sports/sport_types.json (default: %(default)s)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when drift is detected (use in CI).",
    )
    parser.add_argument(
        "--allow-fetch-failure",
        action="store_true",
        help=(
            "Treat upstream fetch/parse failures (network error, malformed "
            "swagger) as warnings and exit 0. For scheduled CI jobs so a "
            "Strava outage doesn't red the build. A local registry error "
            "still exits 2."
        ),
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="HTTP timeout in seconds (default: %(default)s).",
    )
    args = parser.parse_args(argv)

    # Upstream (Strava-side) failures are downgradable to a warning via
    # --allow-fetch-failure so a scheduled CI job tolerates a transient outage.
    upstream_failure_code = 0 if args.allow_fetch_failure else 2

    try:
        swagger = fetch_swagger(args.swagger_url, args.timeout)
    except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
        print(f"ERROR: failed to fetch Strava swagger: {exc}", file=sys.stderr)
        return upstream_failure_code

    try:
        upstream = extract_strava_sport_types(swagger)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return upstream_failure_code

    try:
        local = load_registry_types(args.registry)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: failed to read registry {args.registry}: {exc}", file=sys.stderr)
        return 2

    missing = sorted(upstream - local)
    extra = sorted(local - upstream)

    print(f"Strava SportType enum values: {len(upstream)}")
    print(f"Registry sport_types: {len(local)}")
    print(f"Missing from registry: {len(missing)}")
    if missing:
        print("  Add the following to schemas/sports/sport_types.json:")
        for sport in missing:
            print(f"    - {sport}")
    if extra:
        print(
            f"Registered locally but no longer in Strava enum: {len(extra)}\n"
            "  (Usually safe — Strava rarely removes values; double-check before pruning.)"
        )
        for sport in extra:
            print(f"    - {sport}")

    if missing and args.strict:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
