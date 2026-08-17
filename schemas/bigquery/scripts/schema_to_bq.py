#!/usr/bin/env python
"""
Convert BigQuery schema JSON files to BigQuery CLI format.

This script converts JSON schema definitions to formats needed for table creation.

The inline CLI format only fits a flat, all-scalar schema; anything with a
RECORD or REPEATED column has to go to `bq mk` as a JSON schema file. That is
`activities_full.json` today, so --json is the mode that works for it, and
--minimal is the flat one.

Usage:
    uv run schemas/bigquery/scripts/schema_to_bq.py activities --json    # JSON schema array
    uv run schemas/bigquery/scripts/schema_to_bq.py activities --minimal # inline CLI format
"""

import json
from pathlib import Path
import sys
from typing import Any

# argv[0] is the script itself, so a table name means at least two entries.
_MIN_ARGS = 2


def load_table_schema(table_name: str) -> dict[str, Any]:
    """Load table schema from JSON file."""
    # Navigate from schemas/bigquery/scripts/ to schemas/bigquery/
    schema_file = Path(__file__).parent.parent / f"{table_name}.json"

    if not schema_file.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_file}")

    with schema_file.open() as f:
        data: dict[str, Any] = json.load(f)
    return data


class UnrepresentableSchemaError(ValueError):
    """The schema needs structure the inline `bq mk` format cannot carry."""


def _inline_unrepresentable(fields: list[dict[str, Any]]) -> list[str]:
    """Columns the inline format cannot express, each with its reason.

    Only the top level needs scanning: nested fields exist solely inside a
    RECORD, and the RECORD itself already disqualifies its whole subtree.
    """
    offenders = []

    for field in fields:
        reasons = []
        if field.get("mode") == "REPEATED":
            reasons.append("REPEATED mode")
        if field["type"] == "RECORD":
            reasons.append("RECORD type")
        if reasons:
            offenders.append(f"{field['name']} ({' + '.join(reasons)})")

    return offenders


def schema_to_bq_cli(schema_data: dict[str, Any]) -> str:
    """Convert schema to BigQuery CLI format for 'bq mk' commands.

    The inline format is `name:type` pairs and nothing more: it cannot state a
    mode, and it cannot express a RECORD's nested fields. Every column created
    from one lands as NULLABLE. A schema needing either has to reach `bq mk` as
    a JSON file instead, which is what `--json` emits.

    So a schema that uses RECORD or REPEATED raises rather than emitting a
    string that reads fine and is wrong — `name:RECORD` is not a type `bq mk`
    accepts, and a dropped REPEATED would quietly create a scalar column.
    """
    fields = schema_data["schema"]

    offenders = _inline_unrepresentable(fields)
    if offenders:
        raise UnrepresentableSchemaError(
            "the inline `bq mk` schema format cannot express these columns:\n"
            + "\n".join(f"  - {offender}" for offender in offenders)
            + "\n\nUse --json and pass the result to `bq mk` as a schema file:\n"
            "  bq mk --table --schema=<schema>.json <dataset>.<table>"
        )

    return ",".join(f"{field['name']}:{field['type']}" for field in fields)


def main() -> None:
    if len(sys.argv) < _MIN_ARGS:
        print(
            "Usage: uv run schemas/bigquery/scripts/schema_to_bq.py <table_name> [--json] [--minimal]"
        )
        print("  --json: Output JSON schema format")
        print("  --minimal: Use minimal schema (default: full schema)")
        sys.exit(1)

    table_name = sys.argv[1]
    output_json = "--json" in sys.argv[2:]
    use_minimal = "--minimal" in sys.argv[2:]

    # Determine schema file to use
    schema_suffix = "_minimal" if use_minimal else "_full"

    try:
        schema_filename = f"{table_name}{schema_suffix}"
        schema_data = load_table_schema(schema_filename)

        if output_json:
            # Output just the schema array (for other tools)
            print(json.dumps(schema_data["schema"], indent=2))
        else:
            # Output BigQuery CLI format (for bq mk)
            print(schema_to_bq_cli(schema_data))

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except UnrepresentableSchemaError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error processing schema: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
