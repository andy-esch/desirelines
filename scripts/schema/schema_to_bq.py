#!/usr/bin/env python
"""
Convert BigQuery schema JSON files to BigQuery CLI format.

This script converts JSON schema definitions to formats needed for table creation.

Usage:
    uv run scripts/schema/schema_to_bq.py activities        # Output CLI format
    uv run scripts/schema/schema_to_bq.py activities --json # Output raw schema array
"""

import json
from pathlib import Path
import sys


def load_table_schema(table_name: str) -> dict:
    """Load table schema from JSON file."""
    # Navigate from scripts/schema/ to schemas/bigquery/
    schema_file = Path(__file__).parent.parent.parent / "schemas" / "bigquery" / f"{table_name}.json"

    if not schema_file.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_file}")

    with open(schema_file) as f:
        return json.load(f)


def schema_to_bq_cli(schema_data: dict) -> str:
    """Convert schema to BigQuery CLI format for 'bq mk' commands."""
    fields = []

    for field in schema_data["schema"]:
        # BigQuery CLI format: name:type (no mode specification in CLI)
        # Mode will be handled through the JSON schema instead
        field_def = f"{field['name']}:{field['type']}"
        fields.append(field_def)

    return ",".join(fields)


def main():
    if len(sys.argv) < 2:
        print(
            "Usage: uv run scripts/schema/schema_to_bq.py <table_name> [--json] [--minimal]"
        )
        print("  --json: Output JSON schema format")
        print("  --minimal: Use minimal schema (default: full schema)")
        sys.exit(1)

    table_name = sys.argv[1]
    output_json = "--json" in sys.argv[2:]
    use_minimal = "--minimal" in sys.argv[2:]

    # Determine schema file to use
    if use_minimal:
        schema_suffix = "_minimal"
    else:
        schema_suffix = "_full"

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
    except Exception as e:
        print(f"Error processing schema: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
