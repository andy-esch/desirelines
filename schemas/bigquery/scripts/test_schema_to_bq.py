"""Unit tests for the BQ schema → `bq mk` CLI-format converter.

The behavior under test is mostly a refusal: `bq mk`'s inline schema format
carries `name:type` and nothing else, so a schema using RECORD or REPEATED
columns cannot be expressed in it at all. The converter has to say so instead
of emitting a string that looks right and isn't.

Run via:
    cd schemas/bigquery/scripts && python3 -m pytest test_schema_to_bq.py
"""

import pytest
from schema_to_bq import (
    UnrepresentableSchemaError,
    load_table_schema,
    schema_to_bq_cli,
)


class TestFlatSchema:
    def test_scalars_render_as_name_type_pairs(self):
        cli = schema_to_bq_cli(
            {
                "schema": [
                    {"name": "id", "type": "INTEGER", "mode": "REQUIRED"},
                    {"name": "name", "type": "STRING", "mode": "NULLABLE"},
                ]
            }
        )
        assert cli == "id:INTEGER,name:STRING"

    def test_mode_is_not_emitted(self):
        # Not an omission to fix: the inline format has no slot for a mode, and
        # every column `bq mk` creates from one is NULLABLE regardless.
        cli = schema_to_bq_cli(
            {"schema": [{"name": "id", "type": "INTEGER", "mode": "REQUIRED"}]}
        )
        assert cli == "id:INTEGER"

    def test_field_without_a_mode_is_fine(self):
        cli = schema_to_bq_cli({"schema": [{"name": "id", "type": "INTEGER"}]})
        assert cli == "id:INTEGER"


class TestUnrepresentableSchema:
    def test_record_field_raises_naming_the_column(self):
        with pytest.raises(UnrepresentableSchemaError) as excinfo:
            schema_to_bq_cli(
                {
                    "schema": [
                        {"name": "id", "type": "INTEGER", "mode": "REQUIRED"},
                        {
                            "name": "athlete",
                            "type": "RECORD",
                            "mode": "REQUIRED",
                            "fields": [{"name": "id", "type": "INTEGER"}],
                        },
                    ]
                }
            )
        msg = str(excinfo.value)
        assert "athlete (RECORD type)" in msg
        # The error has to point at the way out, not just the wall.
        assert "--json" in msg

    def test_repeated_field_raises(self):
        with pytest.raises(UnrepresentableSchemaError) as excinfo:
            schema_to_bq_cli(
                {
                    "schema": [
                        {"name": "start_latlng", "type": "FLOAT", "mode": "REPEATED"}
                    ]
                }
            )
        assert "start_latlng (REPEATED mode)" in str(excinfo.value)

    def test_repeated_record_reports_both_reasons(self):
        with pytest.raises(UnrepresentableSchemaError) as excinfo:
            schema_to_bq_cli(
                {
                    "schema": [
                        {
                            "name": "laps",
                            "type": "RECORD",
                            "mode": "REPEATED",
                            "fields": [{"name": "id", "type": "INTEGER"}],
                        }
                    ]
                }
            )
        assert "laps (REPEATED mode + RECORD type)" in str(excinfo.value)

    def test_every_offending_column_is_listed_not_just_the_first(self):
        with pytest.raises(UnrepresentableSchemaError) as excinfo:
            schema_to_bq_cli(
                {
                    "schema": [
                        {"name": "athlete", "type": "RECORD", "mode": "REQUIRED"},
                        {"name": "start_latlng", "type": "FLOAT", "mode": "REPEATED"},
                    ]
                }
            )
        msg = str(excinfo.value)
        assert "athlete" in msg
        assert "start_latlng" in msg


class TestRealSchemas:
    """The two committed schemas sit on opposite sides of this line."""

    def test_full_schema_is_rejected(self):
        # activities_full.json carries RECORD (athlete, map, …) and REPEATED
        # (start_latlng, laps, …) columns, so the inline format cannot hold it.
        with pytest.raises(UnrepresentableSchemaError):
            schema_to_bq_cli(load_table_schema("activities_full"))

    def test_minimal_schema_converts(self):
        cli = schema_to_bq_cli(load_table_schema("activities_minimal"))
        assert cli.startswith("id:INTEGER,")
        assert ":RECORD" not in cli
