"""Cross-language registry decoding and hostile wire-shape checks."""

from dataclasses import fields
import json
from pathlib import Path

import pytest

from stravapipe.adapters.firestore.activity_connection import (
    ConnectionRecord,
    lookup_key,
)

FIXTURE = (
    Path(__file__).resolve().parents[6]
    / "schemas/test-fixtures/activity_connection.json"
)


def test_shared_contract() -> None:
    data = json.loads(FIXTURE.read_text())
    record = ConnectionRecord.from_dict(data)
    assert {f.name for f in fields(ConnectionRecord)} == set(data)
    assert record.uid != record.subject
    assert record.scopes == ["activity:read_all", "read"]


@pytest.mark.parametrize(
    "subject", ["", "0", "01", "+1", "-1", "1/2", "\uff11\uff12", "9223372036854775808"]
)
def test_invalid_subject(subject: str) -> None:
    with pytest.raises(ValueError, match=r"Strava subject|invalid|unexpected|legacy"):
        lookup_key(subject)


@pytest.mark.parametrize(
    "change",
    [
        {"uid": "../other"},
        {"uid": ""},
        {"uid": "x" * 129},
        {"uid": "line\nbreak"},
        {"schema_version": 2},
        {"schema_version": True},
        {"scopes": None},
        {"scopes": [" read"]},
        {"scopes": [123]},
        {"scopes": ["read", "read"]},
        {"status": "unknown"},
        {"status": []},
        {"provenance": []},
        {"provider": "other"},
        {"provenance": "legacy_uid", "bootstrap_id": "x"},
        {"extra": "future-field"},
        {"bootstrap_id": "../operation"},
        {"bootstrap_id": "x" * 129},
        {"bootstrap_id": "é" * 65},
        {"uid": "222", "provenance": "legacy_uid", "bootstrap_id": ""},
    ],
)
def test_reject_invalid_record(change: dict) -> None:
    data = json.loads(FIXTURE.read_text()) | change
    with pytest.raises(ValueError, match=r"Strava subject|invalid|unexpected|legacy"):
        ConnectionRecord.from_dict(data)


@pytest.mark.parametrize(
    "case",
    json.loads(FIXTURE.with_name("activity_connection_scopes.json").read_text()),
    ids=lambda case: case["name"],
)
def test_shared_scope_contract(case: dict) -> None:
    data = json.loads(FIXTURE.read_text()) | {"scopes": case["scopes"]}
    if case["valid"]:
        assert ConnectionRecord.from_dict(data).scopes == case["scopes"]
    else:
        with pytest.raises(ValueError, match="invalid connection record"):
            ConnectionRecord.from_dict(data)
