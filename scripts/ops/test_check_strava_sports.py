"""Regression tests for check-strava-sports.py exit-code contract.

The script is invoked as a CLI (its filename is hyphenated, so it can't be
imported as a module); these tests drive it as a subprocess. They force an
upstream fetch failure with an unreachable ``file://`` URL — no network — and
assert the ``--allow-fetch-failure`` downgrade.

Run:
    python3 -m pytest scripts/ops/test_check_strava_sports.py
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys

SCRIPT = Path(__file__).with_name("check-strava-sports.py")
# A well-formed but nonexistent file:// URL → urllib raises URLError, which is
# exactly the "upstream fetch failure" path, with no network dependency.
BAD_URL = "file:///nonexistent/desirelines/swagger.json"


def _run(*extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--swagger-url",
            BAD_URL,
            "--timeout",
            "2",
            *extra,
        ],
        capture_output=True,
        text=True,
    )


def test_fetch_failure_exits_2_by_default() -> None:
    result = _run()
    assert result.returncode == 2
    assert "failed to fetch Strava swagger" in result.stderr


def test_fetch_failure_exits_0_with_allow_flag() -> None:
    result = _run("--allow-fetch-failure")
    assert result.returncode == 0
    # Still reports the failure on stderr — it's downgraded, not silenced.
    assert "failed to fetch Strava swagger" in result.stderr


def test_allow_flag_does_not_mask_a_strict_run_signature() -> None:
    # --strict alongside --allow-fetch-failure is the intended CI invocation;
    # a fetch failure must still exit 0 (drift, not outage, is what --strict guards).
    result = _run("--strict", "--allow-fetch-failure")
    assert result.returncode == 0
