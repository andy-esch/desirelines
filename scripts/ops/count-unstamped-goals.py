#!/usr/bin/env python3
"""Count stored goal sections that lack the canonical-units stamp.

Goals are stored in canonical units (meters for distance, minutes for time),
and each section, one sport's goals for one year, carries
``storageVersion: 2``. Sections saved before that hold display units (miles,
hours) and no stamp. The web app's goal-unit migration converted those, and was
retired once this count reached zero (2026-10-03, planning task 6ge5ths9ge4b): the
app now reads every account section as canonical. The count stays as a check
that nothing has written an unstamped section since.

Read-only: one collection-group query over every ``users/{uid}/config/*``
document in the ``desirelines-user-configs`` database. Nothing is written.

Usage:
    python3 scripts/ops/count-unstamped-goals.py --env prod
    python3 scripts/ops/count-unstamped-goals.py --emulator 127.0.0.1:8080 [--project demo-x]

Auth: ``gcloud auth print-access-token``. Your gcloud user needs read access
to Firestore in ``desirelines-<env>`` (e.g. ``roles/datastore.viewer``). The
emulator needs none.

Exit codes:
  * ``0`` - no unstamped section holds goals.
  * ``1`` - some do; each is listed by document, year and sport.
  * ``2`` - operational failure (auth, network, or an unexpected response).

Stdlib only, like ``check-strava-sports.py``.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import json
import shutil
import subprocess
import sys
from typing import Any
import urllib.error
import urllib.request

CANONICAL_STORAGE_VERSION = 2
DATABASE = "desirelines-user-configs"
# The emulator only has the default database (see packages/web/src/lib/firebase.ts).
EMULATOR_DATABASE = "(default)"


@dataclass
class Tally:
    documents: int = 0
    stamped: int = 0
    unstamped_empty: int = 0
    # (document path, year, sport, number of goals)
    unstamped_with_goals: list[tuple[str, str, str, int]] = field(default_factory=list)

    @property
    def sections(self) -> int:
        return self.stamped + self.unstamped_empty + len(self.unstamped_with_goals)


def _fields(value: dict[str, Any] | None) -> dict[str, Any]:
    """The fields of a Firestore REST ``mapValue``, or none."""
    return ((value or {}).get("mapValue") or {}).get("fields") or {}


def _int(value: dict[str, Any] | None) -> int | None:
    if not value:
        return None
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return int(value["doubleValue"])
    return None


def tally(documents: list[dict[str, Any]]) -> Tally:
    """Classify every goal section in the given Firestore REST documents."""
    result = Tally()
    for doc in documents:
        result.documents += 1
        path = doc.get("name", "?").split("/documents/", 1)[-1]
        years = _fields((doc.get("fields") or {}).get("goals"))
        for year, year_value in sorted(years.items()):
            sports = _fields(_fields(year_value).get("sports"))
            for sport, section in sorted(sports.items()):
                section_fields = _fields(section)
                goals = (
                    (section_fields.get("goals") or {}).get("arrayValue") or {}
                ).get("values") or []
                if (
                    _int(section_fields.get("storageVersion"))
                    == CANONICAL_STORAGE_VERSION
                ):
                    result.stamped += 1
                elif goals:
                    result.unstamped_with_goals.append((path, year, sport, len(goals)))
                else:
                    result.unstamped_empty += 1
    return result


def _access_token() -> str:
    gcloud = shutil.which("gcloud")
    if gcloud is None:
        raise RuntimeError(
            "gcloud isn't on PATH; install the Google Cloud CLI and log in"
        )
    try:
        out = subprocess.run(  # noqa: S603 -- a fixed gcloud command, resolved from PATH above
            [gcloud, "auth", "print-access-token"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as err:
        raise RuntimeError(f"gcloud auth print-access-token failed: {err}") from err
    return out.stdout.strip()


def fetch_config_documents(
    base: str, project: str, database: str, token: str
) -> list[dict[str, Any]]:
    """Every ``config`` document under any user, via one collection-group query."""
    url = f"{base}/v1/projects/{project}/databases/{database}/documents:runQuery"
    body = json.dumps(
        {
            "structuredQuery": {
                "from": [{"collectionId": "config", "allDescendants": True}]
            }
        }
    ).encode()
    request = urllib.request.Request(  # noqa: S310 -- the Firestore API or a local emulator, never user-supplied schemes
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 -- see the Request note
        rows = json.load(response)
    if not isinstance(rows, list):
        raise TypeError(f"unexpected runQuery response: {str(rows)[:200]}")
    return [row["document"] for row in rows if "document" in row]


def report(result: Tally, where: str) -> str:
    lines = [
        f"{where}: {result.documents} config document(s), {result.sections} goal section(s).",
        f"  stamped (storageVersion {CANONICAL_STORAGE_VERSION}):  {result.stamped}",
        f"  unstamped, holding goals:     {len(result.unstamped_with_goals)}",
        f"  unstamped, empty:             {result.unstamped_empty}",
    ]
    if result.unstamped_with_goals:
        lines.append(
            "Unstamped sections holding goals (the app reads them as canonical; check their values):"
        )
        lines += [
            f"  {path}  {year}  {sport}  ({count} goal{'s' if count != 1 else ''})"
            for path, year, sport, count in result.unstamped_with_goals
        ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--env", choices=["dev", "prod"], help="read desirelines-<env>")
    target.add_argument(
        "--emulator", metavar="HOST:PORT", help="read a Firestore emulator"
    )
    parser.add_argument(
        "--project",
        help="override the project (default: desirelines-<env>, or demo-desirelines on the emulator)",
    )
    args = parser.parse_args(argv)

    if args.emulator:
        base, project, database, token = (
            f"http://{args.emulator}",
            args.project or "demo-desirelines",
            EMULATOR_DATABASE,
            "owner",
        )
        where = f"Firestore emulator {args.emulator}"
    else:
        base, project, database = (
            "https://firestore.googleapis.com",
            args.project or f"desirelines-{args.env}",
            DATABASE,
        )
        where = f"Firestore {database} in {project}"

    try:
        if not args.emulator:
            token = _access_token()
        documents = fetch_config_documents(base, project, database, token)
    except (RuntimeError, TypeError, urllib.error.URLError, OSError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 2

    result = tally(documents)
    print(report(result, where))
    return 1 if result.unstamped_with_goals else 0


if __name__ == "__main__":
    sys.exit(main())
