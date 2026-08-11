"""Parity guard for the Firestore strava_tokens document.

The document at ``users/{athleteID}/private/strava_tokens`` is a three-service
contract: apigateway writes it on the OAuth callback, dispatcher reads and
rewrites it on every refresh, and this package reads it for backfill. Two of
those services are Go and one is Python, so the shape is only type-checked on
one edge — a field rename on either side would otherwise surface as a runtime
decode failure in production rather than a red test.

This file and its Go counterpart
(``packages/shared/stravatoken/parity_test.go``) read the SAME fixture,
``schemas/test-fixtures/strava_tokens.json``. Adding a field on one side without
the other now fails here or there.
"""

from dataclasses import fields
from datetime import datetime
import json
from pathlib import Path
from typing import Any

import pytest

from stravapipe.adapters.firestore.token_store import TokenData


def _resolve_fixtures_path() -> Path:
    """Resolve fixtures path for both uv (repo root) and Pants (sandbox) contexts."""
    repo_root_path = (
        Path(__file__).parents[6] / "schemas" / "test-fixtures" / "strava_tokens.json"
    )
    if repo_root_path.exists():
        return repo_root_path
    # Pants sandbox: schemas/ source root is stripped, file is at test-fixtures/
    return Path("test-fixtures") / "strava_tokens.json"


FIXTURES: list[dict[str, Any]] = json.loads(_resolve_fixtures_path().read_text())
FIXTURE_IDS = [f["name"] for f in FIXTURES]

# The Firestore client hands back datetimes; the fixture stores ISO strings.
_TIMESTAMP_FIELDS = ("connected_at", "last_refreshed")


class _FakeDoc:
    """Minimal DocumentSnapshot stand-in — from_doc only calls to_dict()."""

    def __init__(self, data: dict[str, Any] | None):
        self._data = data

    def to_dict(self) -> dict[str, Any] | None:
        return self._data


def _as_firestore_doc(raw: dict[str, Any]) -> dict[str, Any]:
    """Convert fixture JSON into what the Firestore client would return."""
    doc = dict(raw)
    for key in _TIMESTAMP_FIELDS:
        if key in doc:
            doc[key] = datetime.fromisoformat(doc[key].replace("Z", "+00:00"))
    return doc


@pytest.mark.parametrize("fixture", FIXTURES, ids=FIXTURE_IDS)
def test_shared_fixtures_strava_tokens_decode(fixture: dict[str, Any]) -> None:
    """Every shared fixture decodes to the expected TokenData."""
    doc = _FakeDoc(_as_firestore_doc(fixture["doc"]))
    expected = fixture["expected"]

    tokens = TokenData.from_doc(doc)  # type: ignore[arg-type]

    assert tokens.access_token == expected["access_token"]
    assert tokens.refresh_token == expected["refresh_token"]
    assert tokens.expires_at == expected["expires_at"]
    assert tokens.scopes == expected["scopes"]
    assert tokens.connected_at == datetime.fromisoformat(
        expected["connected_at"].replace("Z", "+00:00")
    )
    assert tokens.last_refreshed == datetime.fromisoformat(
        expected["last_refreshed"].replace("Z", "+00:00")
    )


def test_shared_fixtures_strava_tokens_field_coverage() -> None:
    """The fixture must name exactly the fields TokenData declares.

    This is the half that actually catches drift. The decode test would still
    pass if someone added a field to TokenData and to the fixture but not to Go;
    asserting the fixture matches the dataclass forces any new Python field into
    the shared fixture, which then breaks the Go coverage test until it is
    taught the field.
    """
    declared = {f.name for f in fields(TokenData)}
    full = FIXTURES[0]
    assert full["name"] == "all fields present", (
        "fixture[0] must be the fully-populated case"
    )

    missing = declared - set(full["doc"])
    assert not missing, (
        f"fixture omits {sorted(missing)}, so no cross-language test covers them"
    )

    extra = set(full["doc"]) - declared
    assert not extra, (
        f"fixture carries {sorted(extra)}, which TokenData does not declare"
    )
