#!/usr/bin/env python3
"""Generate a proto2 schema from a BigQuery JSON table schema.

Input:  schemas/bigquery/activities_full.json
Output: schemas/proto/desirelines/bigquery/v1/bq_activities.proto

Pants picks up the generated proto via its ``protobuf_sources`` target
and codegens ``bq_activities_pb2.py`` for stravapipe to import. The
just recipe ``proto-gen-backend`` runs this generator before invoking
Pants. CI's ``verify-schemas`` re-runs the generator and diffs against
the committed output to catch drift.

Run: ``just generate-bq-proto``

**Why proto2, not proto3.** BigQuery Storage Write API rejects
descriptors that carry the ``[proto3_optional=true]`` annotation —
which is what proto3's ``optional`` keyword emits. Per Google's
[Storage Write API best practices](https://docs.cloud.google.com/bigquery/docs/write-api-best-practices),
use proto2 syntax with explicit field labels.

Type mapping (BQ → proto2):
    INTEGER   → int64
    FLOAT     → double  (BQ FLOAT is 64-bit; proto's `float` is 32-bit)
    STRING    → string
    BOOLEAN   → bool
    TIMESTAMP → int64   (micros-since-epoch; not the proto well-known
                         Timestamp message — BQ Storage Write doesn't
                         accept that)
    JSON      → string  (JSON-encoded text)
    RECORD    → nested message (recursive)

Mode mapping (BQ → proto2):
    REPEATED  any     → ``repeated``
    anything else     → ``optional``

Every non-repeated field is labeled ``optional`` regardless of BQ's
REQUIRED/NULLABLE designation — BQ enforces REQUIRED server-side at
insert time, and proto2 needs every field to carry an explicit label.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BQ_SCHEMA_PATH = REPO_ROOT / "schemas/bigquery/activities_full.json"
OUTPUT_PATH = REPO_ROOT / "schemas/proto/desirelines/bigquery/v1/bq_activities.proto"


# Intentionally incomplete: only the BQ scalar types that activities_full.json
# actually uses are mapped. An unmapped type (BYTES, DATE, DATETIME, NUMERIC,
# BIGNUMERIC, GEOGRAPHY, …) is a fail-fast in _emit_field — add it here
# explicitly when a new type appears in the schema.
_BQ_TO_PROTO_SCALAR: dict[str, str] = {
    "INTEGER": "int64",
    "FLOAT": "double",
    "STRING": "string",
    "BOOLEAN": "bool",
    "JSON": "string",  # JSON-encoded; see module docstring
}
# TIMESTAMP is deliberately absent: the two profiles encode it differently, so
# _emit_field resolves it from the profile before consulting this map.


@dataclass(frozen=True)
class _Profile:
    """The parts of the emitted proto that differ per consumer.

    Two consumers want the same table shape with different encodings:

    - **storage-write** — the BigQuery Storage Write API, via stravapipe.
      Requires TIMESTAMP as int64 micros-since-epoch. Python only.
    - **pubsub-cdc** — the Pub/Sub BigQuery subscription, via the dispatcher.
      Its proto→BQ mapping accepts a `string` for a TIMESTAMP column provided
      the value is a valid BigQuery timestamp, which Strava's RFC 3339 already
      is. That lets the producer pass timestamps through untouched instead of
      converting every one, so this profile takes `string`. It also carries the
      two CDC pseudocolumns, and generates Go.

    Both are emitted from the same BQ schema, so the table stays the single
    source of truth for either path.
    """

    output_path: Path
    proto_package: str
    message_name: str
    timestamp_type: str
    timestamp_note: str
    purpose: str
    go_package: str | None = None
    cdc_fields: bool = False
    # Whether field numbers come from the committed lock rather than position.
    # Only the encoding that travels as binary needs it.
    locked_numbers: bool = False


# The CDC pseudocolumns, shaped like BQ columns so the normal field emitter
# handles them. They are not columns in activities_full.json — BigQuery
# consumes them as operation metadata rather than storing them — so they are
# appended here rather than added to the table schema.
#
# Their field numbers are PINNED, unlike every other field, which is numbered by
# position. On a schema-bound topic the encoding is binary, so the field number
# is the wire identity: if these were numbered by position they would shift the
# moment a column is added to the table, and messages already in flight would
# decode into the wrong fields. Pinning them far above the column range means
# the table can grow without ever disturbing them.
_CDC_FIELD_NUMBER = "_proto_field_number"
_CDC_COLUMNS: list[dict[str, Any]] = [
    {
        "name": "_CHANGE_TYPE",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "CDC operation: UPSERT or DELETE",
        _CDC_FIELD_NUMBER: 998,
    },
    {
        "name": "_CHANGE_SEQUENCE_NUMBER",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "CDC ordering key; hex sections compared as unsigned numbers",
        _CDC_FIELD_NUMBER: 999,
    },
]

STORAGE_WRITE = _Profile(
    output_path=REPO_ROOT / "schemas/proto/desirelines/bigquery/v1/bq_activities.proto",
    proto_package="desirelines.bigquery.v1",
    message_name="Activity",
    timestamp_type="int64",
    timestamp_note="micros since epoch",
    purpose=(
        "Mirrors the BigQuery `activities` table schema for use with the\n"
        "// BigQuery Storage Write API."
    ),
    # Only Python consumes this proto, but `go_package` is not optional:
    # `pants export-codegen` runs every enabled backend, and protoc-gen-go
    # fails outright on a proto that lacks it. The generated Go is never copied
    # into the source tree — see proto-gen-backend, which copies by filename.
    go_package="github.com/andy-esch/desirelines/packages/stravapipe/types/generated",
)

PUBSUB_CDC = _Profile(
    # Its own directory and proto package, deliberately. Sharing a package with
    # the Python-only bq_activities proto made Pants' Go backend try to generate
    # Go for that one too, which fails since it has no `option go_package`.
    output_path=REPO_ROOT
    / "schemas/proto/desirelines/bigquery/cdc/v1/bq_activity_rows.proto",
    proto_package="desirelines.bigquery.cdc.v1",
    message_name="ActivityRow",
    timestamp_type="string",
    timestamp_note="RFC 3339 string; Pub/Sub maps string to a TIMESTAMP column",
    purpose=(
        "Mirrors the BigQuery `activities` table schema for the Pub/Sub\n"
        "// BigQuery subscription (use_topic_schema), plus the CDC\n"
        "// pseudocolumns. Timestamps are strings here, not micros: the\n"
        "// subscription accepts a string for a TIMESTAMP column, so the\n"
        "// producer forwards Strava's RFC 3339 values unchanged."
    ),
    go_package="github.com/andy-esch/desirelines/packages/dispatcher/types/generated",
    cdc_fields=True,
    locked_numbers=True,
)

PROFILES: tuple[_Profile, ...] = (STORAGE_WRITE, PUBSUB_CDC)

# Committed field-number assignments for the pubsub-cdc profile.
#
# That profile is published as binary against a Pub/Sub topic schema, where a
# field's NUMBER is its wire identity. Numbering by position would make
# appending a column safe but inserting or reordering one silently destructive:
# every following field shifts and in-flight messages decode into the wrong
# fields. Locking the assignments makes position irrelevant — a column can move
# anywhere in the BQ schema and keep its number.
#
# Regenerating updates this file: existing paths keep their number, new ones get
# the next free one in their message. Numbers are never reused.
FIELD_NUMBERS_PATH = REPO_ROOT / "schemas/bigquery/cdc_field_numbers.json"

# Guard for the positional numbering in _emit_message: growing the table past
# these would silently collide with the pins.
_PINNED_FIELD_NUMBERS: frozenset[int] = frozenset(
    col[_CDC_FIELD_NUMBER] for col in _CDC_COLUMNS
)


def _to_message_name(field_name: str) -> str:
    """snake_case → PascalCase for nested message types."""
    return "".join(part.capitalize() for part in field_name.split("_"))


@dataclass
class _Emit:
    """Mutable accumulator for the recursive emit step."""

    lines: list[str]
    # Locked `Message.field` → number assignments, mutated as new fields are
    # allocated. None means number by position (the storage-write profile,
    # which is matched by name and does not care).
    numbers: dict[str, int] | None = None
    # Defaults to the original profile so callers that predate the split — and
    # the generator's own unit tests — construct an _Emit unchanged.
    profile: _Profile = STORAGE_WRITE
    indent: int = 0

    def write(self, line: str = "") -> None:
        if line:
            self.lines.append("  " * self.indent + line)
        else:
            self.lines.append("")


def _emit_message(
    schema: list[dict[str, Any]],
    name: str,
    out: _Emit,
) -> None:
    """Emit `message <name> { ... }` from a BQ field list.

    Recurses on RECORD types via `nested_type` definitions inside the
    parent message's scope.
    """
    out.write(f"message {name} {{")
    out.indent += 1

    # First pass: emit nested message types so they're in scope for fields.
    for col in schema:
        if col["type"] == "RECORD":
            nested_name = _to_message_name(col["name"])
            _emit_message(col["fields"], nested_name, out)
            out.write()

    # Second pass: emit field declarations.
    field_number = 1
    for col in schema:
        pinned = col.get(_CDC_FIELD_NUMBER)
        if pinned is not None:
            _emit_field(col, pinned, out)
            continue
        if out.numbers is not None:
            _emit_field(col, _locked_number(out.numbers, name, col["name"]), out)
            continue
        if field_number in _PINNED_FIELD_NUMBERS:
            raise RuntimeError(
                f"positional numbering reached {field_number}, which is pinned for a "
                "CDC pseudocolumn; move the pins higher before growing the table"
            )
        _emit_field(col, field_number, out)
        field_number += 1

    out.indent -= 1
    out.write("}")


def _locked_number(numbers: dict[str, int], message: str, field: str) -> int:
    """Return this field's locked number, allocating one if it is new.

    Allocation is per-message and takes the next free number above whatever that
    message already uses, so a new column can never take a number an existing
    one has held. Numbers are never reused, so removing a column leaves a gap
    rather than handing its number to something else.
    """
    key = f"{message}.{field}"
    if key in numbers:
        return numbers[key]

    prefix = f"{message}."
    used = {n for k, n in numbers.items() if k.startswith(prefix)}
    candidate = 1
    while candidate in used or candidate in _PINNED_FIELD_NUMBERS:
        candidate += 1
    numbers[key] = candidate
    return candidate


def _emit_field(col: dict[str, Any], field_number: int, out: _Emit) -> None:
    """Emit a single proto field declaration with the appropriate label."""
    name = col["name"]
    mode = col["mode"]
    bq_type = col["type"]

    description = col.get("description", "").strip()
    if description:
        # Emit the description as a single comment line above the field.
        # Flatten any embedded line breaks: a multi-line BQ description would
        # otherwise spill its second line below the `//`, where protoc reads
        # it as an orphan token and fails with a misleading parse error.
        # splitlines() handles \n, \r\n, and \r uniformly without the
        # double-space a chained .replace() would leave on \r\n.
        flattened = " ".join(description.splitlines())
        out.write(f"// {flattened}")

    if bq_type == "RECORD":
        type_name = _to_message_name(name)
    elif bq_type == "TIMESTAMP":
        # Profile-driven: the two consumers disagree on the encoding.
        type_name = out.profile.timestamp_type
    else:
        try:
            type_name = _BQ_TO_PROTO_SCALAR[bq_type]
        except KeyError:
            raise RuntimeError(
                f"BQ type {bq_type!r} on field {name!r} has no proto mapping; "
                "add it to _BQ_TO_PROTO_SCALAR"
            ) from None

    # Proto2: every non-repeated field needs an explicit label. We mark
    # everything `optional` (even fields BQ declares REQUIRED) per
    # Google's BQ Storage Write API guidance; BQ enforces REQUIRED at
    # insert time independently of the proto label.
    prefix = "repeated " if mode == "REPEATED" else "optional "

    # Add a tag comment for TIMESTAMP/JSON so readers know the BQ semantics.
    #
    # Exactly ONE space before `//`: this file is generated, but it still lives
    # under schemas/proto, so `just format` runs `buf format -w` over it. buf
    # normalizes trailing comments to a single space, so emitting two would make
    # format and `--check` disagree — running `just format` would leave this file
    # dirty and fail `just verify-schemas` until it was regenerated. Keep the
    # generator's output byte-identical to buf's canonical form.
    suffix = ""
    if bq_type == "TIMESTAMP":
        suffix = f" // BQ TIMESTAMP — {out.profile.timestamp_note}"
    elif bq_type == "JSON":
        suffix = " // BQ JSON — JSON-encoded string"

    out.write(f"{prefix}{type_name} {name} = {field_number};{suffix}")


def load_field_numbers() -> dict[str, int]:
    """Read the committed field-number lock, or start empty on first run."""
    if not FIELD_NUMBERS_PATH.exists():
        return {}
    return json.loads(FIELD_NUMBERS_PATH.read_text())


def generate(
    bq_schema_path: Path = BQ_SCHEMA_PATH,
    profile: _Profile = STORAGE_WRITE,
    numbers: dict[str, int] | None = None,
) -> str:
    """Produce the full `.proto` file content from the BQ JSON schema.

    For the pubsub-cdc profile, ``numbers`` is the field-number lock; it is
    mutated in place as new fields are allocated so the caller can persist it.
    """
    schema_doc = json.loads(bq_schema_path.read_text())
    schema = schema_doc["schema"]
    if profile.cdc_fields:
        # Appended, not merged into the table schema: BigQuery consumes these
        # as operation metadata rather than storing them as columns.
        schema = schema + _CDC_COLUMNS
    # Hardcoded: BQ table name is plural ("activities"); proto convention
    # is singular for row-shaped messages. If we generalize this generator
    # to other tables, accept the message name as input rather than
    # depluralize automatically (English plurals are gnarly).
    message_name = profile.message_name

    rel_input = bq_schema_path.relative_to(REPO_ROOT).as_posix()

    header = [
        "// Code generated by schemas/bigquery/generate_proto.py. DO NOT EDIT.",
        f"// Source: {rel_input}",
        "//",
        f"// {profile.purpose}",
        "//",
        "// Field numbering is sequential per-message; consumers match by name,",
        "// not number, so reordering is safe.",
        "//",
        "// Syntax is proto2 (NOT proto3) because Storage Write rejects",
        "// descriptors carrying the [proto3_optional=true] annotation that",
        "// proto3's `optional` keyword emits. Every non-repeated field is",
        "// labeled `optional`; BQ enforces REQUIRED at insert time.",
        "//",
        "// Regenerate: just generate-bq-proto    Verify in CI: just verify-schemas",
        "",
        'syntax = "proto2";',
        "",
        f"package {profile.proto_package};",
        "",
        *_go_package_lines(profile),
        "",
    ]

    if profile.locked_numbers and numbers is None:
        numbers = load_field_numbers()
    out = _Emit(lines=header.copy(), profile=profile, numbers=numbers)
    _emit_message(schema, message_name, out)

    # Trailing newline for POSIX hygiene.
    return "\n".join(out.lines) + "\n"


def _go_package_lines(profile: _Profile) -> list[str]:
    """The `option go_package` declaration, or an explanation of its absence.

    `go_package` and the target's `go_mod_address` must be set together. With
    the option but no address, Pants' Go backend generates Go for the proto and
    cannot tell which of the repo's several `go_mod` targets owns it — every
    broad goal then fails with InvalidTargetException. See schemas/proto/BUILD.
    """
    if profile.go_package is None:
        return [
            "// Deliberately no `option go_package`: this proto is Python-only,",
            "// and declaring it without a matching `go_mod_address` on the",
            "// Pants target makes the owning Go module ambiguous.",
        ]
    return [
        "// Generates Go; the Pants target sets a matching `go_mod_address`.",
        f'option go_package = "{profile.go_package}";',
    ]


def main(argv: list[str] | None = None) -> int:
    """Regenerate every profile and write. With ``--check``, regenerate
    in-memory and exit non-zero if any output differs from its committed
    file. ``--check`` is the form `verify-schemas` calls in CI.
    """
    args = argv if argv is not None else sys.argv[1:]
    check_only = "--check" in args

    failed = False
    numbers = load_field_numbers()
    for profile in PROFILES:
        content = generate(
            profile=profile, numbers=numbers if profile.locked_numbers else None
        )
        rel_output = profile.output_path.relative_to(REPO_ROOT).as_posix()

        if check_only:
            existing = (
                profile.output_path.read_text() if profile.output_path.exists() else ""
            )
            if existing != content:
                print(
                    f"FAIL: {rel_output} is out of sync with activities_full.json.\n"
                    "   Run: just generate-bq-proto",
                    file=sys.stderr,
                )
                failed = True
            else:
                print(f"OK: {rel_output} is in sync")
            continue

        profile.output_path.parent.mkdir(parents=True, exist_ok=True)
        profile.output_path.write_text(content)
        print(f"OK: generated {rel_output} ({len(content)} bytes)")

    if not check_only:
        FIELD_NUMBERS_PATH.write_text(
            json.dumps(dict(sorted(numbers.items())), indent=2) + "\n"
        )
    elif numbers != load_field_numbers():
        print(
            f"FAIL: {FIELD_NUMBERS_PATH.relative_to(REPO_ROOT).as_posix()} is out of sync.\n"
            "   Run: just generate-bq-proto",
            file=sys.stderr,
        )
        failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
