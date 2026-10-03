#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "requests>=2.32",
#     "polyline>=2.0.4",
# ]
# ///
"""Compare one activity's Strava polyline geometry against its streams.

Temporary diagnostic: see README.md in this directory for when to delete it.

Answers "where would splitting this route at a pause fall, and can the polyline
alone find the pause?". It writes GeoJSON meant to be overlaid in a GIS tool and
prints an attribute and gap report to stdout:

    activity_<id>_polyline.geojson   map.polyline and map.summary_polyline
    activity_<id>_streams.geojson    the raw stream track, plus the same points
                                     split into a MultiLineString at each gap

Both stream features share identical vertices; only the connectivity differs.
The raw stream LineString still draws the false connector across a pause (no
points are recorded while recording is stopped), which is the artifact being
hunted.

Authentication uses a Strava OAuth *access token*, not the client id/secret. Get
a short-lived one from https://www.strava.com/settings/api or the API playground.
Private activities need the `activity:read_all` scope. The token is read from
$STRAVA_ACCESS_TOKEN by default so it stays out of shell history.

Usage:
    export STRAVA_ACCESS_TOKEN="..."

    # Two GeoJSON files + the attribute report
    uv run scripts/ops/routes/compare_route_sources.py 1234567890

    # Per-vertex points carrying every stream value, for attribute inspection
    uv run scripts/ops/routes/compare_route_sources.py 1234567890 --points

    # Keep the raw API responses for schema archaeology
    uv run scripts/ops/routes/compare_route_sources.py 1234567890 --raw

    # Tune the split rule and see how the part count responds
    uv run scripts/ops/routes/compare_route_sources.py 1234567890 \
        --gap-seconds 20 --gap-meters 100

Read-only: nothing here writes to the database or to Strava.
"""

import argparse
from dataclasses import dataclass
from http import HTTPStatus
from itertools import pairwise
import json
import math
import os
from pathlib import Path
import statistics
import sys
from typing import Any

import polyline as polyline_codec
import requests

API_BASE = "https://www.strava.com/api/v3"

# Every stream Strava documents. Unavailable ones are simply absent from the
# response (a bike with no power meter has no `watts`), which is itself the
# attribute inventory this script reports.
ALL_STREAM_KEYS = [
    "time",
    "latlng",
    "distance",
    "altitude",
    "velocity_smooth",
    "moving",
    "grade_smooth",
    "heartrate",
    "cadence",
    "watts",
    "temp",
]

# A split needs BOTH a time discontinuity and a geographic jump. Time alone
# would split an auto-pause at a traffic light (recording stops, but you have
# not moved); distance alone is the ambiguous signal that makes the polyline
# approach a guess in the first place.
DEFAULT_GAP_SECONDS = 30.0
DEFAULT_GAP_METERS = 150.0

EARTH_RADIUS_M = 6371008.8  # mean radius; matches PostGIS's sphere

# A LineString (and so each part of a MultiLineString) needs two points.
MIN_LINESTRING_POINTS = 2

# Strava streams give [lat, lng]; GeoJSON and decode_polyline give [lng, lat].
# The names keep the two orders from being mixed up.
LatLng = list[float]
LngLat = list[float]
Feature = dict[str, Any]


class StravaError(RuntimeError):
    """A Strava API call failed in a way worth explaining to the operator."""


@dataclass(frozen=True)
class Gap:
    """A split point: the step into vertex `index` cleared both thresholds."""

    index: int
    jump_m: float
    dt_s: float | None  # None when there is no time stream

    @property
    def implied_speed_mps(self) -> float | None:
        return self.jump_m / self.dt_s if self.dt_s else None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two WGS84 points."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlam = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def line_length_m(coords: list[LngLat]) -> float:
    """Traced length in meters of a [lng, lat] line."""
    return sum(
        haversine_m(lat1, lon1, lat2, lon2)
        for (lon1, lat1), (lon2, lat2) in pairwise(coords)
    )


def _get(
    session: requests.Session, url: str, params: dict[str, Any] | None = None
) -> Any:
    resp = session.get(url, params=params, timeout=30)

    # Surface the budget: one activity costs 2 calls here.
    limit = resp.headers.get("X-RateLimit-Limit")
    usage = resp.headers.get("X-RateLimit-Usage")
    if limit and usage:
        print(
            f"  [rate limit] usage {usage} of {limit} (15min, daily)", file=sys.stderr
        )

    if resp.status_code == HTTPStatus.UNAUTHORIZED:
        raise StravaError(
            "401 Unauthorized. The access token is missing, expired (they last ~6 "
            "hours), or lacks scope. Private activities need `activity:read_all`."
        )
    if resp.status_code == HTTPStatus.NOT_FOUND:
        raise StravaError(
            "404 Not Found. Either the activity id is wrong or it belongs to "
            "another athlete."
        )
    if resp.status_code == HTTPStatus.TOO_MANY_REQUESTS:
        raise StravaError("429 Rate limited. Wait for the next 15-minute window.")
    if not resp.ok:
        raise StravaError(f"{resp.status_code} from {url}: {resp.text[:300]}")
    return resp.json()


def fetch_activity(session: requests.Session, activity_id: int) -> dict[str, Any]:
    result: dict[str, Any] = _get(session, f"{API_BASE}/activities/{activity_id}")
    return result


def fetch_streams(session: requests.Session, activity_id: int) -> dict[str, Any]:
    """Fetch every documented stream.

    `resolution` and `series_type` are deliberately not sent: the current
    swagger spec accepts only `keys` and `key_by_type`, and returns resolution as
    a *response* property. The older docs (and most wrappers) still describe them
    as request parameters.
    """
    result: dict[str, Any] = _get(
        session,
        f"{API_BASE}/activities/{activity_id}/streams",
        params={"keys": ",".join(ALL_STREAM_KEYS), "key_by_type": "true"},
    )
    return result


def decode_polyline(encoded: str | None) -> list[LngLat]:
    """Decode to GeoJSON [lng, lat] order. Empty list when there is nothing."""
    if not encoded:
        return []
    return [list(pt) for pt in polyline_codec.decode(encoded, geojson=True)]


def aligned_times(streams: dict[str, Any], latlng: list[LatLng]) -> list[float] | None:
    """The time stream, or None when it is absent or not index-aligned.

    Gap timing indexes `time` by `latlng` position, so a length mismatch would
    pair the wrong samples. Falling back to None reports the distance-only rule
    instead of a wrong one.
    """
    times: list[float] | None = (streams.get("time") or {}).get("data")
    if times is None:
        return None
    if len(times) != len(latlng):
        print(
            f"  warning: time stream has {len(times)} points but latlng has "
            f"{len(latlng)}; ignoring time and using the distance-only rule.",
            file=sys.stderr,
        )
        return None
    return times


def analyze_gaps(
    latlng: list[LatLng],
    times: list[float] | None,
    gap_seconds: float,
    gap_meters: float,
) -> tuple[list[Gap], list[float]]:
    """Find split points and return (gaps, per-vertex step distances in meters).

    `steps[i]` is the distance from vertex i-1 to i (`steps[0]` is 0). Without a
    time stream the rule degrades to distance-only, which is the polyline
    heuristic, and the report labels it as such.
    """
    steps: list[float] = [0.0]
    gaps: list[Gap] = []

    for i in range(1, len(latlng)):
        lat1, lon1 = latlng[i - 1]
        lat2, lon2 = latlng[i]
        jump_m = haversine_m(lat1, lon1, lat2, lon2)
        steps.append(jump_m)

        dt = times[i] - times[i - 1] if times is not None else None
        distance_ok = jump_m > gap_meters
        time_ok = dt is None or dt > gap_seconds
        if distance_ok and time_ok:
            gaps.append(Gap(index=i, jump_m=jump_m, dt_s=dt))
    return gaps, steps


def split_parts(latlng: list[LatLng], gaps: list[Gap]) -> list[list[LngLat]]:
    """Cut the track at each gap index into [lng, lat] parts.

    Parts of fewer than two points are dropped because they cannot form a
    LineString. A gap on either side of one vertex strands it, and splitting
    in PostGIS drops it the same way.
    """
    cut_at = {g.index for g in gaps}
    parts: list[list[LngLat]] = []
    current: list[LngLat] = []

    for i, (lat, lon) in enumerate(latlng):
        if i in cut_at and current:
            parts.append(current)
            current = []
        current.append([lon, lat])
    if current:
        parts.append(current)

    return [p for p in parts if len(p) >= MIN_LINESTRING_POINTS]


def feature(geometry: dict[str, Any], props: dict[str, Any]) -> Feature:
    return {"type": "Feature", "geometry": geometry, "properties": props}


def polyline_features(
    activity_id: int,
    name: str,
    sport: str | None,
    detailed: list[LngLat],
    summary: list[LngLat],
) -> list[Feature]:
    features: list[Feature] = []
    if detailed:
        features.append(
            feature(
                {"type": "LineString", "coordinates": detailed},
                {
                    "source": "map.polyline",
                    "activity_id": activity_id,
                    "name": name,
                    "sport": sport,
                    "point_count": len(detailed),
                    "note": "simplified by Strava; the webhook path stores this",
                },
            )
        )
    if summary:
        features.append(
            feature(
                {"type": "LineString", "coordinates": summary},
                {
                    "source": "map.summary_polyline",
                    "activity_id": activity_id,
                    "point_count": len(summary),
                    "note": "coarser and privacy-trimmed; all the list endpoint returns",
                },
            )
        )
    return features


def stream_features(
    activity_id: int,
    latlng: list[LatLng],
    parts: list[list[LngLat]],
    gaps: list[Gap],
    has_time_stream: bool,
    gap_seconds: float,
    gap_meters: float,
) -> list[Feature]:
    return [
        feature(
            {"type": "LineString", "coordinates": [[lon, lat] for lat, lon in latlng]},
            {
                "source": "streams.latlng.raw",
                "activity_id": activity_id,
                "point_count": len(latlng),
                "note": "every recorded point, still connected across pauses",
            },
        ),
        feature(
            {"type": "MultiLineString", "coordinates": parts},
            {
                "source": "streams.latlng.split",
                "activity_id": activity_id,
                "part_count": len(parts),
                "gap_count": len(gaps),
                "gap_seconds": gap_seconds,
                "gap_meters": gap_meters,
                "has_time_stream": has_time_stream,
                "note": "the same points, split into parts at each gap",
            },
        ),
    ]


def point_features(
    latlng: list[LatLng],
    streams: dict[str, Any],
    steps: list[float],
    times: list[float] | None,
    gaps: list[Gap],
) -> list[Feature]:
    """One Point per stream vertex, carrying every scalar stream value."""
    scalar_keys = [
        k
        for k in ALL_STREAM_KEYS
        if k != "latlng" and k in streams and streams[k].get("data")
    ]
    gap_starts = {g.index for g in gaps}
    features: list[Feature] = []
    for i, (lat, lon) in enumerate(latlng):
        props: dict[str, Any] = {"index": i, "step_m": round(steps[i], 2)}
        for k in scalar_keys:
            data = streams[k]["data"]
            if i < len(data):
                props[k] = data[i]
        if times is not None and i > 0:
            props["dt_s"] = times[i] - times[i - 1]
        props["is_gap_start"] = i in gap_starts
        features.append(feature({"type": "Point", "coordinates": [lon, lat]}, props))
    return features


def write_geojson(path: Path, features: list[Feature]) -> None:
    path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, indent=2)
    )
    print(f"  wrote {path}")


def report_stream_attributes(streams: dict[str, Any]) -> None:
    """Print the attribute inventory: what each stream is and how big it is."""
    print("\n=== Stream attributes available ===")
    if not streams:
        print("  (none: activity has no streams)")
        return

    print(f"  {'key':<16} {'type':<10} {'n':>7}  {'orig':>7}  {'res':<8} sample")
    print(f"  {'-' * 16} {'-' * 10} {'-' * 7}  {'-' * 7}  {'-' * 8} {'-' * 30}")
    for key in ALL_STREAM_KEYS:
        s = streams.get(key)
        if s is None:
            continue
        data = s.get("data") or []
        sample = json.dumps(data[0]) if data else "-"
        print(
            f"  {key:<16} {s.get('type')!s:<10} {len(data):>7}  "
            f"{s.get('original_size')!s:>7}  {s.get('resolution')!s:<8} {sample}"
        )

    missing = [k for k in ALL_STREAM_KEYS if k not in streams]
    if missing:
        print(f"\n  not present for this activity: {', '.join(missing)}")

    # Downsampling check. When resolution < original_size Strava has thinned the
    # series, which widens the apparent time step and can fake a gap.
    for key, s in streams.items():
        orig, n = s.get("original_size"), len(s.get("data") or [])
        if orig and n and orig != n:
            print(
                f"\n  ! `{key}` was downsampled: {orig} original points -> {n} "
                f"returned. Time deltas are inflated; treat gap timings as upper bounds."
            )
            break


def report_gaps(
    gaps: list[Gap],
    steps: list[float],
    times: list[float] | None,
    gap_seconds: float,
    gap_meters: float,
    part_count: int,
) -> None:
    print("\n=== Gap analysis (streams) ===")
    rule = (
        f"jump > {gap_meters:.0f} m AND dt > {gap_seconds:.0f} s"
        if times is not None
        else f"jump > {gap_meters:.0f} m (NO time stream: distance-only, the "
        f"polyline heuristic)"
    )
    print(f"  rule: {rule}")

    if steps[1:]:
        print(
            f"  vertex spacing: median {statistics.median(steps[1:]):.1f} m, "
            f"max {max(steps[1:]):.1f} m"
        )
    if times is not None and len(times) > 1:
        dts = [b - a for a, b in pairwise(times)]
        print(
            f"  time step:      median {statistics.median(dts):.1f} s, "
            f"max {max(dts):.1f} s"
        )

    if not gaps:
        print("  no gaps found: this activity would stay a single LineString.")
        return

    print(f"\n  {len(gaps)} gap(s) -> {part_count} part(s):")
    print(f"    {'index':>7}  {'jump_m':>10}  {'dt_s':>10}  {'implied m/s':>12}")
    for g in gaps:
        dt = f"{g.dt_s:.0f}" if g.dt_s is not None else "-"
        speed = g.implied_speed_mps
        spd = f"{speed:.1f}" if speed is not None else "-"
        print(f"    {g.index:>7}  {g.jump_m:>10.1f}  {dt:>10}  {spd:>12}")


def report_source_comparison(
    detailed: list[LngLat],
    summary: list[LngLat],
    stream_latlng: list[LatLng],
    recorded_distance_m: float | None,
) -> None:
    """Contrast the three geometry sources on density and length.

    The length comparison is the corroboration signal: simplification only ever
    makes a track shorter than the odometer, so geometry LONGER than the
    recorded distance is independent evidence of an unrecorded jump.
    """
    print("\n=== Source comparison ===")
    stream_lnglat = [[lon, lat] for lat, lon in stream_latlng]

    print(f"  {'source':<24} {'points':>8}  {'length_m':>12}")
    print(f"  {'-' * 24} {'-' * 8}  {'-' * 12}")
    for label, coords in (
        ("map.polyline", detailed),
        ("map.summary_polyline", summary),
        ("streams latlng", stream_lnglat),
    ):
        if coords:
            print(f"  {label:<24} {len(coords):>8}  {line_length_m(coords):>12.1f}")
        else:
            print(f"  {label:<24} {'-':>8}  {'-':>12}")

    if recorded_distance_m:
        print(f"  {'activity.distance':<24} {'-':>8}  {recorded_distance_m:>12.1f}")
        for label, coords in (
            ("map.polyline", detailed),
            ("streams latlng", stream_lnglat),
        ):
            if not coords:
                continue
            excess = line_length_m(coords) - recorded_distance_m
            verdict = (
                "LONGER than odometer -> unrecorded jump present"
                if excess > 0
                else "shorter than odometer -> consistent with simplification alone"
            )
            print(f"    {label}: {excess:+.1f} m: {verdict}")


def report_polyline_vs_streams(
    detailed: list[LngLat],
    stream_gaps: list[Gap],
    gap_seconds: float,
    gap_meters: float,
) -> None:
    """Would the polyline alone, with no time stream, find the same gaps?"""
    poly_latlng = [[lat, lon] for lon, lat in detailed]
    poly_gaps, _ = analyze_gaps(poly_latlng, None, gap_seconds, gap_meters)
    print("\n=== Would the polyline alone have found them? ===")
    print(
        f"  streams (time+distance rule): {len(stream_gaps)} gap(s)\n"
        f"  polyline (distance-only rule): {len(poly_gaps)} candidate(s) "
        f"at > {gap_meters:.0f} m"
    )
    if len(poly_gaps) > len(stream_gaps):
        print(
            f"  -> {len(poly_gaps) - len(stream_gaps)} of the polyline's candidates "
            f"are likely FALSE splits (straight roads simplified to long segments)."
        )
    elif len(poly_gaps) < len(stream_gaps):
        print(
            f"  -> the polyline MISSES {len(stream_gaps) - len(poly_gaps)} real "
            f"gap(s) at this threshold."
        )
    else:
        print("  -> same count at this threshold (check they are the same places).")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare Strava polyline geometry against the streams API.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("activity_id", type=int, help="Strava activity id")
    parser.add_argument(
        "--token",
        default=os.environ.get("STRAVA_ACCESS_TOKEN"),
        help="OAuth access token (default: $STRAVA_ACCESS_TOKEN)",
    )
    parser.add_argument(
        "--out-dir", type=Path, default=Path(), help="output directory (default: .)"
    )
    parser.add_argument(
        "--gap-seconds",
        type=float,
        default=DEFAULT_GAP_SECONDS,
        help=f"time discontinuity that marks a split (default: {DEFAULT_GAP_SECONDS:g})",
    )
    parser.add_argument(
        "--gap-meters",
        type=float,
        default=DEFAULT_GAP_METERS,
        help=f"geographic jump that marks a split (default: {DEFAULT_GAP_METERS:g})",
    )
    parser.add_argument(
        "--points",
        action="store_true",
        help="also write per-vertex Points carrying every stream value",
    )
    parser.add_argument(
        "--raw", action="store_true", help="also write the raw API JSON responses"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.token:
        print(
            "error: no access token. Set $STRAVA_ACCESS_TOKEN or pass --token.\n"
            "Get one from https://www.strava.com/settings/api "
            "(scope `activity:read_all` for private activities).",
            file=sys.stderr,
        )
        return 2

    args.out_dir.mkdir(parents=True, exist_ok=True)
    try:
        with requests.Session() as session:
            session.headers["Authorization"] = f"Bearer {args.token}"
            print(f"Fetching activity {args.activity_id}...", file=sys.stderr)
            activity = fetch_activity(session, args.activity_id)
            print("Fetching streams...", file=sys.stderr)
            streams = fetch_streams(session, args.activity_id)
    except StravaError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except requests.RequestException as exc:
        print(f"error: request failed: {exc}", file=sys.stderr)
        return 1

    analyze_and_write(args, activity, streams)
    return 0


def analyze_and_write(
    args: argparse.Namespace, activity: dict[str, Any], streams: dict[str, Any]
) -> None:
    """Write the GeoJSON outputs and print every report for one fetched activity."""
    name = activity.get("name", "")
    sport = activity.get("sport_type") or activity.get("type")
    recorded_distance = activity.get("distance")
    print(f"\nActivity {args.activity_id}: {name!r} ({sport})")
    print(
        f"  moving_time={activity.get('moving_time')}s "
        f"elapsed_time={activity.get('elapsed_time')}s "
        f"distance={recorded_distance}m"
    )
    # elapsed > moving is the cheapest hint that recording was interrupted.
    moving, elapsed = activity.get("moving_time"), activity.get("elapsed_time")
    if isinstance(moving, int) and isinstance(elapsed, int) and elapsed > moving:
        print(
            f"  note: elapsed exceeds moving by {elapsed - moving}s, consistent "
            f"with a pause (auto-pause or a stop/restart)."
        )

    activity_map = activity.get("map") or {}
    detailed = decode_polyline(activity_map.get("polyline"))
    summary = decode_polyline(activity_map.get("summary_polyline"))
    latlng: list[LatLng] = (streams.get("latlng") or {}).get("data") or []
    times = aligned_times(streams, latlng)

    gaps: list[Gap] = []
    steps: list[float] = [0.0]
    parts: list[list[LngLat]] = []
    if latlng:
        gaps, steps = analyze_gaps(latlng, times, args.gap_seconds, args.gap_meters)
        parts = split_parts(latlng, gaps)

    print("\n=== Output ===")
    poly = polyline_features(args.activity_id, name, sport, detailed, summary)
    if not poly:
        print("  warning: activity has no polyline (indoor/manual?).", file=sys.stderr)
    write_geojson(args.out_dir / f"activity_{args.activity_id}_polyline.geojson", poly)

    if not latlng:
        print("  warning: no latlng stream for this activity.", file=sys.stderr)
    write_geojson(
        args.out_dir / f"activity_{args.activity_id}_streams.geojson",
        stream_features(
            args.activity_id,
            latlng,
            parts,
            gaps,
            times is not None,
            args.gap_seconds,
            args.gap_meters,
        )
        if latlng
        else [],
    )

    if args.points and latlng:
        write_geojson(
            args.out_dir / f"activity_{args.activity_id}_stream_points.geojson",
            point_features(latlng, streams, steps, times, gaps),
        )

    if args.raw:
        for label, payload in (("activity", activity), ("streams", streams)):
            path = args.out_dir / f"activity_{args.activity_id}_{label}_raw.json"
            path.write_text(json.dumps(payload, indent=2))
            print(f"  wrote {path}")

    report_stream_attributes(streams)
    if latlng:
        report_gaps(gaps, steps, times, args.gap_seconds, args.gap_meters, len(parts))
    report_source_comparison(detailed, summary, latlng, recorded_distance)
    if detailed and latlng:
        report_polyline_vs_streams(detailed, gaps, args.gap_seconds, args.gap_meters)


if __name__ == "__main__":
    sys.exit(main())
