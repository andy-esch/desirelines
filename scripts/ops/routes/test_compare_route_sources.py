"""Tests for compare_route_sources.py's gap detection and geometry helpers.

Loaded by path like the sibling ops-script tests. No network: every case runs on
synthetic tracks heading north along a meridian in ~11 m steps.

Run:
    pants test scripts/ops/routes::
"""

import importlib.util
from pathlib import Path
import sys

import pytest

SCRIPT = Path(__file__).with_name("compare_route_sources.py")
_spec = importlib.util.spec_from_file_location("compare_route_sources", SCRIPT)
assert _spec is not None
assert _spec.loader is not None
crs = importlib.util.module_from_spec(_spec)
sys.modules["compare_route_sources"] = crs
_spec.loader.exec_module(crs)

ONE_DEGREE_M = 111_195.08  # one degree of arc on the PostGIS sphere
STEP_DEG = 1e-4  # ~11.1 m


def _track(n: int, start_lat: float = 0.0) -> list[list[float]]:
    """n [lat, lng] stream points heading north from start_lat."""
    return [[start_lat + i * STEP_DEG, 0.0] for i in range(n)]


def _paused_track() -> tuple[list[list[float]], list[float]]:
    """Two 5-point legs joined by a ~1 km jump that took ~10 minutes."""
    leg1 = _track(5)
    leg2 = _track(5, start_lat=leg1[-1][0] + 0.009)
    times = [float(i) for i in range(5)] + [600.0 + i for i in range(5)]
    return leg1 + leg2, times


def test_haversine_one_degree_of_latitude() -> None:
    assert crs.haversine_m(0.0, 0.0, 1.0, 0.0) == pytest.approx(ONE_DEGREE_M, abs=0.5)


def test_line_length_reads_lnglat_order() -> None:
    one_degree_north = [[0.0, 0.0], [0.0, 1.0]]
    assert crs.line_length_m(one_degree_north) == pytest.approx(ONE_DEGREE_M, abs=0.5)
    assert crs.line_length_m(one_degree_north[:1]) == 0.0
    assert crs.line_length_m([]) == 0.0


def test_decode_polyline_returns_lnglat() -> None:
    # Google's reference encoding of (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
    assert crs.decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == [
        [-120.2, 38.5],
        [-120.95, 40.7],
        [-126.453, 43.252],
    ]
    assert crs.decode_polyline(None) == []
    assert crs.decode_polyline("") == []


def test_a_pause_is_a_gap_when_time_and_distance_both_jump() -> None:
    latlng, times = _paused_track()

    gaps, steps = crs.analyze_gaps(latlng, times, gap_seconds=30, gap_meters=150)

    assert [g.index for g in gaps] == [5]
    assert gaps[0].jump_m == pytest.approx(0.009 * ONE_DEGREE_M, abs=1)
    assert gaps[0].dt_s == 596.0
    assert gaps[0].implied_speed_mps == pytest.approx(gaps[0].jump_m / 596.0)
    assert len(steps) == len(latlng)
    assert steps[0] == 0.0


def test_an_auto_pause_without_moving_is_not_a_gap() -> None:
    times = [0.0, 1.0, 2.0, 302.0, 303.0, 304.0]  # five minutes at a light

    gaps, _ = crs.analyze_gaps(_track(6), times, gap_seconds=30, gap_meters=150)

    assert gaps == []


def test_a_long_step_without_a_time_gap_is_not_a_gap() -> None:
    fast_200m_step = [[0.0, 0.0], [0.0018, 0.0]]

    gaps, _ = crs.analyze_gaps(
        fast_200m_step, [0.0, 5.0], gap_seconds=30, gap_meters=150
    )

    assert gaps == []


def test_without_a_time_stream_distance_alone_decides() -> None:
    latlng, _ = _paused_track()

    gaps, _ = crs.analyze_gaps(latlng, None, gap_seconds=30, gap_meters=150)

    assert [g.index for g in gaps] == [5]
    assert gaps[0].dt_s is None
    assert gaps[0].implied_speed_mps is None


def test_split_parts_cuts_at_each_gap_in_lnglat_order() -> None:
    latlng, times = _paused_track()
    gaps, _ = crs.analyze_gaps(latlng, times, gap_seconds=30, gap_meters=150)

    parts = crs.split_parts(latlng, gaps)

    assert [len(p) for p in parts] == [5, 5]
    assert parts[1][0] == [latlng[5][1], latlng[5][0]]


def test_split_parts_drops_a_stranded_vertex() -> None:
    gaps = [
        crs.Gap(index=3, jump_m=500.0, dt_s=None),
        crs.Gap(index=4, jump_m=500.0, dt_s=None),
    ]

    parts = crs.split_parts(_track(6), gaps)

    assert [len(p) for p in parts] == [3, 2]


def test_split_parts_without_gaps_is_one_part() -> None:
    latlng = _track(4)

    assert crs.split_parts(latlng, []) == [[[lng, lat] for lat, lng in latlng]]


def test_aligned_times_drops_a_misaligned_stream(
    capsys: pytest.CaptureFixture[str],
) -> None:
    latlng = _track(3)

    assert crs.aligned_times({"time": {"data": [0.0, 1.0, 2.0]}}, latlng) == [
        0.0,
        1.0,
        2.0,
    ]
    assert crs.aligned_times({}, latlng) is None
    assert crs.aligned_times({"time": {"data": [0.0, 1.0]}}, latlng) is None
    assert "ignoring time" in capsys.readouterr().err


def test_missing_token_exits_2_before_calling_strava(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.delenv("STRAVA_ACCESS_TOKEN", raising=False)

    assert crs.main(["123", "--out-dir", str(tmp_path / "out")]) == 2
    assert "no access token" in capsys.readouterr().err
    assert not (tmp_path / "out").exists()
