"""Regression tests for check-strava-sports.py exit-code contract.

Registry parsing tests load the hyphenated script through importlib. CLI tests
force an upstream fetch failure with an unreachable ``file://`` URL — no network
— and assert the ``--allow-fetch-failure`` downgrade. Local schema failures remain
operational errors even when that downgrade is requested.

Run:
    python3 -m pytest scripts/ops/test_check_strava_sports.py
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import ModuleType

import pytest

SCRIPT = Path(__file__).with_name("check-strava-sports.py")
# A well-formed but nonexistent file:// URL → urllib raises URLError, which is
# exactly the "upstream fetch failure" path, with no network dependency.
BAD_URL = "file:///nonexistent/desirelines/swagger.json"


def _script_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_strava_sports", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_registry_reads_strava_mapping_and_omits_sentinel(tmp_path: Path) -> None:
    registry = {
        "version": "2.0",
        "sportCategories": {
            "cycling": {
                "mappings": {
                    "strava.sport_type": {
                        "types": ["Ride", "__unmapped_sport_type__"],
                        "excludedTypes": ["EBikeRide"],
                    }
                }
            }
        },
    }
    path = tmp_path / "registry.json"
    path.write_text(json.dumps(registry))
    assert _script_module().load_registry_types(path) == {"Ride", "EBikeRide"}


@pytest.mark.parametrize(
    "mapping",
    [
        {},
        {"strava.type": {"types": ["Ride"], "excludedTypes": []}},
        {"strava.sport_type": {"types": "Ride", "excludedTypes": []}},
        {"strava.sport_type": {"types": [], "excludedTypes": []}},
    ],
)
def test_malformed_registry_is_rejected(
    tmp_path: Path, mapping: dict[str, dict[str, list[str] | str]]
) -> None:
    path = tmp_path / "registry.json"
    path.write_text(
        json.dumps(
            {"version": "2.0", "sportCategories": {"cycling": {"mappings": mapping}}}
        )
    )
    with pytest.raises((ValueError, KeyError)):
        _script_module().load_registry_types(path)


@pytest.mark.parametrize("extra_args", [[], ["--allow-fetch-failure"]])
def test_cli_does_not_downgrade_local_registry_errors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    extra_args: list[str],
) -> None:
    module = _script_module()
    monkeypatch.setattr(
        module,
        "fetch_swagger",
        lambda *_args: {"definitions": {"SportType": {"enum": ["Ride"]}}},
    )
    path = tmp_path / "registry.json"
    path.write_text('{"version":"2.0","sportCategories":{"cycling":{}}}')
    assert module.main(["--registry", str(path), *extra_args]) == 2
    assert "failed to read registry" in capsys.readouterr().err


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
        check=False,  # tests assert on returncode; a non-zero exit is expected
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
