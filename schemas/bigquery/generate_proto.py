#!/usr/bin/env python3
"""Generate a proto3 schema from a BigQuery JSON table schema.

Input:  schemas/bigquery/activities_full.json
Output: schemas/proto/desirelines/bigquery/v1/activities.proto

This sits in the same lane as the hand-written `.proto` files under
`schemas/proto/`: Pants picks up the generated proto via its
`protobuf_sources` target and codegens `activities_pb2.py` for stravapipe
to import. The just recipe `proto-gen-backend` runs this generator
*before* invoking Pants, so the proto file is always fresh.

Run via:
    just generate-bq-proto
    # or directly:
    python schemas/bigquery/generate_proto.py

The generated `.proto` file should be committed (same convention as
`*_pb2.py` files). CI's `verify-schemas` recipe re-runs this generator
and diffs the output against the committed file to catch drift.

Type mapping (BQ → proto3):
    INTEGER   → int64
    FLOAT     → double  (BQ FLOAT is 64-bit; proto's `float` is 32-bit)
    STRING    → string
    BOOLEAN   → bool
    TIMESTAMP → int64   (microseconds since Unix epoch — BQ Storage Write
                         API convention; not the proto well-known
                         Timestamp message)
    JSON      → string  (BQ JSON column accepts JSON-encoded text)
    RECORD    → nested message (recursive)

Mode mapping (BQ → proto3):
    REQUIRED  scalar  → bare field
    NULLABLE  scalar  → `optional` (proto3.15+ presence semantics)
    NULLABLE  RECORD  → bare field (messages have presence by default)
    REPEATED  any     → `repeated`

REQUIRED is *not* enforced at the proto layer — proto3 has no concept
of required fields. BQ enforces REQUIRED at insert time independently.
This generator just produces the wire shape.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BQ_SCHEMA_PATH = REPO_ROOT / "schemas/bigquery/activities_full.json"
OUTPUT_PATH = (
    REPO_ROOT / "schemas/proto/desirelines/bigquery/v1/bq_activities.proto"
)


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
        # Wrap descriptions onto a comment line above the field.
        out.write(f"// {description}")

    if bq_type == "RECORD":
        type_name = _to_message_name(name)
    else:
        type_name = _BQ_TO_PROTO_SCALAR[bq_type]

    if mode == "REPEATED":
        prefix = "repeated "
    elif mode == "NULLABLE" and bq_type != "RECORD":
        # Messages have presence by default; only mark scalars as `optional`
        # to get HasField() semantics for NULL distinction.
        prefix = "optional "
    else:
        prefix = ""

    # Add a tag comment for TIMESTAMP/JSON so readers know the BQ semantics.
    suffix = ""
    if bq_type == "TIMESTAMP":
        suffix = "  // BQ TIMESTAMP — micros since epoch"
    elif bq_type == "JSON":
        suffix = "  // BQ JSON — JSON-encoded string"

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
        "// This proto mirrors the BigQuery `activities` table schema for use",
        "// with the BigQuery Storage Write API. Field numbering is sequential",
        "// per-message and is stable within a single regeneration; the API",
        "// matches by name, not number, so reordering is safe.",
        "//",
        "// Regenerate via: just generate-bq-proto",
        "// CI checks drift via: just verify-schemas",
        "",
        'syntax = "proto3";',
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
                f"❌ {rel_output} is out of sync with activities_full.json.\n"
                "   Run: just generate-bq-proto",
                file=sys.stderr,
            )
            return 1
        print(f"✅ {rel_output} is in sync")
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(content)
    print(f"✅ Generated {rel_output} ({len(content)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
