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
    "TIMESTAMP": "int64",  # micros-since-epoch; see module docstring
    "JSON": "string",  # JSON-encoded; see module docstring
}


def _to_message_name(field_name: str) -> str:
    """snake_case → PascalCase for nested message types."""
    return "".join(part.capitalize() for part in field_name.split("_"))


@dataclass
class _Emit:
    """Mutable accumulator for the recursive emit step."""

    lines: list[str]
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
        _emit_field(col, field_number, out)
        field_number += 1

    out.indent -= 1
    out.write("}")


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
    if mode == "REPEATED":
        prefix = "repeated "
    else:
        prefix = "optional "

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
        suffix = " // BQ TIMESTAMP — micros since epoch"
    elif bq_type == "JSON":
        suffix = " // BQ JSON — JSON-encoded string"

    out.write(f"{prefix}{type_name} {name} = {field_number};{suffix}")


def generate(bq_schema_path: Path = BQ_SCHEMA_PATH) -> str:
    """Produce the full `.proto` file content from the BQ JSON schema."""
    schema_doc = json.loads(bq_schema_path.read_text())
    schema = schema_doc["schema"]
    # Hardcoded: BQ table name is plural ("activities"); proto convention
    # is singular for row-shaped messages. If we generalize this generator
    # to other tables, accept the message name as input rather than
    # depluralize automatically (English plurals are gnarly).
    message_name = "Activity"

    rel_input = bq_schema_path.relative_to(REPO_ROOT).as_posix()

    header = [
        "// Code generated by schemas/bigquery/generate_proto.py. DO NOT EDIT.",
        f"// Source: {rel_input}",
        "//",
        "// Mirrors the BigQuery `activities` table schema for use with the",
        "// BigQuery Storage Write API. Field numbering is sequential per-",
        "// message; the API matches by name, not number, so reordering is",
        "// safe.",
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
        "package desirelines.bigquery.v1;",
        "",
        "// `go_package` is required by protoc-gen-go even though we don't",
        "// consume the Go output today. Points at the stravapipe generated",
        "// dir to match the Python output's conceptual location.",
        'option go_package = "github.com/andy-esch/desirelines/packages/stravapipe/types/generated";',
        "",
    ]

    out = _Emit(lines=header.copy())
    _emit_message(schema, message_name, out)

    # Trailing newline for POSIX hygiene.
    return "\n".join(out.lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    """Default mode: regenerate and write. With ``--check``, regenerate
    in-memory and exit non-zero if the result differs from the committed
    file. ``--check`` is the form `verify-schemas` calls in CI.
    """
    args = argv if argv is not None else sys.argv[1:]
    check_only = "--check" in args

    content = generate()
    rel_output = OUTPUT_PATH.relative_to(REPO_ROOT).as_posix()

    if check_only:
        existing = OUTPUT_PATH.read_text() if OUTPUT_PATH.exists() else ""
        if existing != content:
            print(
                f"FAIL: {rel_output} is out of sync with activities_full.json.\n"
                "   Run: just generate-bq-proto",
                file=sys.stderr,
            )
            return 1
        print(f"OK: {rel_output} is in sync")
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(content)
    print(f"OK: generated {rel_output} ({len(content)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
