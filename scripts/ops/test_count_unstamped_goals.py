"""Tests for count-unstamped-goals.py's section classification and CLI contract.

The script's filename is hyphenated, so it's loaded by path. The classification
runs on Firestore REST documents shaped as the API returns them; no network.

Run:
    python3 -m pytest scripts/ops/test_count_unstamped_goals.py
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys
from typing import Any

SCRIPT = Path(__file__).with_name("count-unstamped-goals.py")
_spec = importlib.util.spec_from_file_location("count_unstamped_goals", SCRIPT)
assert _spec is not None
assert _spec.loader is not None
cug = importlib.util.module_from_spec(_spec)
sys.modules["count_unstamped_goals"] = cug
_spec.loader.exec_module(cug)


def _map(fields: dict[str, Any]) -> dict[str, Any]:
    return {"mapValue": {"fields": fields}}


def _section(goals: int, stamp: dict[str, Any] | None = None) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "goals": {
            "arrayValue": {"values": [_map({"value": {"integerValue": "1"}})] * goals}
        }
        if goals
        else {"arrayValue": {}}
    }
    if stamp is not None:
        fields["storageVersion"] = stamp
    return _map(fields)


def _doc(
    uid: str, sections: dict[str, dict[str, dict[str, Any]]] | None
) -> dict[str, Any]:
    fields: dict[str, Any] = {"schemaVersion": {"stringValue": "2.1"}}
    if sections is not None:
        fields["goals"] = _map(
            {year: _map({"sports": _map(sports)}) for year, sports in sections.items()}
        )
    return {
        "name": f"projects/p/databases/d/documents/users/{uid}/config/v1",
        "fields": fields,
    }


def test_counts_stamped_unstamped_and_empty_sections() -> None:
    docs = [
        _doc(
            "a",
            {
                "2025": {
                    "cycling": _section(2, {"integerValue": "2"}),
                    "running": _section(3),  # legacy: display units, no stamp
                },
                "2026": {"yoga": _section(0)},  # nothing to convert
            },
        ),
        _doc(
            "b", {"2026": {"cycling": _section(1, {"integerValue": "1"})}}
        ),  # old stamp
        _doc("c", None),  # preferences only
    ]

    result = cug.tally(docs)

    assert result.documents == 3
    assert result.stamped == 1
    assert result.unstamped_empty == 1
    assert result.unstamped_with_goals == [
        ("users/a/config/v1", "2025", "running", 3),
        ("users/b/config/v1", "2026", "cycling", 1),
    ]
    assert result.sections == 4


def test_a_stamp_stored_as_a_double_still_counts() -> None:
    result = cug.tally(
        [_doc("a", {"2026": {"cycling": _section(1, {"doubleValue": 2.0})}})]
    )
    assert result.stamped == 1
    assert result.unstamped_with_goals == []


def test_report_lists_each_unstamped_section_holding_goals() -> None:
    result = cug.tally([_doc("a", {"2025": {"running": _section(1)}})])
    text = cug.report(result, "here")
    assert "unstamped, holding goals:     1" in text
    assert "users/a/config/v1  2025  running  (1 goal)" in text


def test_cli_needs_exactly_one_target() -> None:
    for args in ([], ["--env", "prod", "--emulator", "127.0.0.1:1"]):
        run = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            capture_output=True,
            text=True,
            check=False,
        )
        assert run.returncode == 2
        assert "usage:" in run.stderr


def test_an_unreachable_emulator_is_an_operational_failure() -> None:
    run = subprocess.run(
        [sys.executable, str(SCRIPT), "--emulator", "127.0.0.1:9"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert run.returncode == 2
    assert run.stderr.startswith("error:")
