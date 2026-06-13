"""Unit tests for the BQ JSON → proto generator.

Each test exercises one transformation rule. The integration is also
covered by the round-trip test in
``packages/stravapipe/tests/unit/adapters/gcp/test_bigquery_storage.py``,
but the targeted tests here document expected output and catch
regressions in the generator itself before the round-trip notices.

Run via:
    cd schemas/bigquery && python3 -m pytest test_generate_proto.py
"""

from __future__ import annotations

import pytest

from generate_proto import generate, _emit_message, _Emit, _to_message_name


def _render(schema: list[dict]) -> str:
    """Render a tiny schema as a single message body for assertion."""
    out = _Emit(lines=[])
    _emit_message(schema, "T", out)
    return "\n".join(out.lines)


class TestTypeMapping:
    def test_required_int(self):
        # proto2: every non-repeated field carries an explicit label, so even
        # a BQ REQUIRED scalar is emitted `optional` (BQ enforces REQUIRED at
        # insert time, independent of the proto label).
        body = _render([{"name": "id", "type": "INTEGER", "mode": "REQUIRED"}])
        assert "optional int64 id = 1;" in body

    def test_nullable_string_uses_optional(self):
        body = _render([{"name": "x", "type": "STRING", "mode": "NULLABLE"}])
        assert "optional string x = 1;" in body

    def test_repeated_float(self):
        body = _render([{"name": "ll", "type": "FLOAT", "mode": "REPEATED"}])
        assert "repeated double ll = 1;" in body

    def test_required_bool_to_bool(self):
        body = _render([{"name": "p", "type": "BOOLEAN", "mode": "REQUIRED"}])
        assert "bool p = 1;" in body

    def test_timestamp_emits_int64_with_comment(self):
        body = _render([{"name": "ts", "type": "TIMESTAMP", "mode": "REQUIRED"}])
        assert "int64 ts = 1;" in body
        assert "BQ TIMESTAMP" in body

    def test_json_emits_string_with_comment(self):
        body = _render([{"name": "j", "type": "JSON", "mode": "REQUIRED"}])
        assert "string j = 1;" in body
        assert "BQ JSON" in body


class TestRecordHandling:
    def test_required_record_emits_nested_message(self):
        # proto2: a RECORD field gets the same explicit `optional` label as a
        # scalar; the nested message is declared in the parent's scope.
        schema = [
            {
                "name": "athlete",
                "type": "RECORD",
                "mode": "REQUIRED",
                "fields": [
                    {"name": "id", "type": "INTEGER", "mode": "REQUIRED"},
                ],
            }
        ]
        body = _render(schema)
        assert "message Athlete {" in body
        assert "optional Athlete athlete = 1;" in body

    def test_nullable_record_emits_optional(self):
        schema = [
            {
                "name": "gear",
                "type": "RECORD",
                "mode": "NULLABLE",
                "fields": [
                    {"name": "id", "type": "STRING", "mode": "REQUIRED"},
                ],
            }
        ]
        body = _render(schema)
        assert "message Gear {" in body
        assert "optional Gear gear = 1;" in body

    def test_repeated_record_uses_repeated(self):
        schema = [
            {
                "name": "laps",
                "type": "RECORD",
                "mode": "REPEATED",
                "fields": [
                    {"name": "distance", "type": "FLOAT", "mode": "REQUIRED"},
                ],
            }
        ]
        body = _render(schema)
        assert "message Laps {" in body
        assert "repeated Laps laps = 1;" in body

    def test_nested_records_share_no_namespace(self):
        """Two RECORDs at different paths can have inner submessages
        with the same name — proto scopes them to the parent."""
        schema = [
            {
                "name": "outer_a",
                "type": "RECORD",
                "mode": "REQUIRED",
                "fields": [
                    {
                        "name": "inner",
                        "type": "RECORD",
                        "mode": "REQUIRED",
                        "fields": [
                            {"name": "x", "type": "INTEGER", "mode": "REQUIRED"}
                        ],
                    }
                ],
            },
            {
                "name": "outer_b",
                "type": "RECORD",
                "mode": "REQUIRED",
                "fields": [
                    {
                        "name": "inner",
                        "type": "RECORD",
                        "mode": "REQUIRED",
                        "fields": [{"name": "y", "type": "STRING", "mode": "REQUIRED"}],
                    }
                ],
            },
        ]
        body = _render(schema)
        # Both nested Inner messages exist, scoped to their parents.
        # We don't try to do collision detection — proto's scoping
        # handles it.
        assert body.count("message Inner {") == 2


class TestNaming:
    def test_snake_to_pascal(self):
        assert _to_message_name("athlete") == "Athlete"
        assert _to_message_name("segment_efforts") == "SegmentEfforts"
        assert _to_message_name("a_b_c") == "ABC"

    def test_field_descriptions_become_comments(self):
        body = _render(
            [
                {
                    "name": "id",
                    "type": "INTEGER",
                    "mode": "REQUIRED",
                    "description": "Strava activity ID",
                }
            ]
        )
        assert "// Strava activity ID" in body


class TestDescriptionFlattening:
    """A multi-line BQ description must collapse to a single `//` comment.
    Otherwise the second line spills below the comment as an orphan token and
    protoc fails with a misleading parse error far from the real schema bug.
    """

    def test_multiline_description_stays_one_comment_line(self):
        body = _render(
            [
                {
                    "name": "x",
                    "type": "INTEGER",
                    "mode": "REQUIRED",
                    "description": "First line\nsecond line\r\nthird",
                }
            ]
        )
        lines = body.splitlines()
        comment_lines = [
            ln for ln in lines if ln.strip().startswith("//") and "First line" in ln
        ]
        # Exactly one comment line, carrying the whole flattened description.
        assert len(comment_lines) == 1
        assert "second line" in comment_lines[0]
        assert "third" in comment_lines[0]
        # No orphan line escaped below the comment.
        assert not any(ln.strip() == "second line" for ln in lines)
        assert not any(ln.strip() == "third" for ln in lines)


class TestUnmappedType:
    def test_unmapped_bq_type_raises_runtime_error_naming_field(self):
        with pytest.raises(RuntimeError) as excinfo:
            _render([{"name": "geo", "type": "GEOGRAPHY", "mode": "NULLABLE"}])
        msg = str(excinfo.value)
        # The error must name the offending type, the field, and where to fix.
        assert "GEOGRAPHY" in msg
        assert "geo" in msg
        assert "_BQ_TO_PROTO_SCALAR" in msg


class TestFullSchema:
    """Smoke test: generating against the actual repo's BQ schema must
    succeed and produce a non-empty proto file."""

    def test_generate_produces_valid_proto(self):
        content = generate()
        assert 'syntax = "proto2";' in content
        assert "package desirelines.bigquery.v1;" in content
        assert "message Activity {" in content
        # Sanity check: enough fields that we know it walked the schema.
        assert content.count("= ") > 50

    def test_generated_output_is_deterministic(self):
        # Two calls produce identical output. Catches accidental
        # nondeterminism (set iteration, dict ordering pre-3.7, etc.).
        assert generate() == generate()
