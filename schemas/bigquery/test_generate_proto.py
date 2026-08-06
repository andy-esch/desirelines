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

import json
import re

import generate_proto
from generate_proto import (
    _CDC_COLUMNS,
    BQ_SCHEMA_PATH,
    PUBSUB_CDC,
    STORAGE_WRITE,
    _Emit,
    _emit_message,
    _to_message_name,
    generate,
)
import pytest


def _render(schema: list[dict]) -> str:
    """Render a tiny schema as a single message body for assertion."""
    out = _Emit(lines=[])
    _emit_message(schema, "T", out)
    return "\n".join(out.lines)


# NOTE on `optional`: the generated proto is **proto2**, because the BigQuery
# Storage Write API rejects descriptors carrying the `[proto3_optional=true]`
# annotation that proto3's `optional` keyword emits (see the generate_proto
# module docstring and adapters/gcp/_bigquery_storage.py). In proto2 every
# non-repeated field needs an explicit label, so the generator labels them all
# `optional` — including BQ-REQUIRED fields and nested RECORDs. These tests
# assert that proto2 contract; do not "simplify" them back to proto3
# expectations.
class TestTypeMapping:
    def test_required_int(self):
        # proto2: every non-repeated field carries an explicit label, so even
        # a BQ REQUIRED scalar is emitted `optional` (BQ enforces REQUIRED at
        # insert time, independent of the proto label).
        body = _render([{"name": "id", "type": "INTEGER", "mode": "REQUIRED"}])
        # proto2: a BQ-REQUIRED scalar is still labeled `optional`.
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
        assert "optional int64 ts = 1;" in body
        assert "BQ TIMESTAMP" in body

    def test_json_emits_string_with_comment(self):
        body = _render([{"name": "j", "type": "JSON", "mode": "REQUIRED"}])
        assert "optional string j = 1;" in body
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
        # proto2, not proto3 — BQ Storage Write rejects the proto3_optional
        # annotation. This assertion is the canary for an accidental syntax flip.
        assert 'syntax = "proto2";' in content
        assert "package desirelines.bigquery.v1;" in content
        assert "message Activity {" in content
        # Sanity check: enough fields that we know it walked the schema.
        assert content.count("= ") > 50

    def test_generated_output_is_deterministic(self):
        # Two calls produce identical output. Catches accidental
        # nondeterminism (set iteration, dict ordering pre-3.7, etc.).
        assert generate() == generate()


class TestProfiles:
    """The two consumers want the same table with different encodings, so the
    generator emits one proto per profile from the same BQ schema."""

    def test_storage_write_keeps_timestamps_as_micros(self):
        content = generate(profile=STORAGE_WRITE)
        assert "message Activity {" in content
        assert "optional int64 start_date = " in content
        # Python-only, so no Go is generated for it by name.
        assert "optional string _CHANGE_TYPE" not in content

    def test_pubsub_cdc_uses_string_timestamps(self):
        # Pub/Sub's proto→BQ mapping accepts a string for a TIMESTAMP column,
        # which lets the producer forward Strava's RFC 3339 values untouched
        # instead of converting every one to micros.
        content = generate(profile=PUBSUB_CDC)
        assert "message ActivityRow {" in content
        assert "optional string start_date = " in content
        assert "optional int64 start_date = " not in content

    def test_pubsub_cdc_carries_the_cdc_fields(self):
        content = generate(profile=PUBSUB_CDC)
        assert "optional string _CHANGE_TYPE = " in content
        assert "optional string _CHANGE_SEQUENCE_NUMBER = " in content

    def test_cdc_field_numbers_are_pinned_not_positional(self):
        """The CDC fields must keep their numbers as the table grows.

        On a schema-bound topic the encoding is binary, so the field number is
        the wire identity. Numbering these by position would shift them the
        moment a column is added, silently mis-decoding messages in flight.
        """
        content = generate(profile=PUBSUB_CDC)
        assert "optional string _CHANGE_TYPE = 998;" in content
        assert "optional string _CHANGE_SEQUENCE_NUMBER = 999;" in content

        # Adding a column must not move them.
        schema = json.loads(BQ_SCHEMA_PATH.read_text())["schema"]
        grown = [*schema, {"name": "new_col", "type": "STRING", "mode": "NULLABLE"}]
        out = _Emit(lines=[], profile=PUBSUB_CDC)
        _emit_message([*grown, *_CDC_COLUMNS], "ActivityRow", out)
        body = "\n".join(out.lines)
        assert "optional string _CHANGE_TYPE = 998;" in body
        assert "optional string _CHANGE_SEQUENCE_NUMBER = 999;" in body

    def test_positional_numbering_colliding_with_a_pin_is_fatal(self):
        # Better to fail the build than to silently renumber a CDC field.
        schema = [
            {"name": f"c{i}", "type": "STRING", "mode": "NULLABLE"} for i in range(999)
        ]
        out = _Emit(lines=[], profile=PUBSUB_CDC)
        with pytest.raises(RuntimeError) as excinfo:
            _emit_message([*schema, *_CDC_COLUMNS], "T", out)
        assert "998" in str(excinfo.value)


def _field_numbers(proto_text: str) -> dict[str, int]:
    """Map ``Message.field`` → field number for every field in a .proto.

    Deliberately a small regex walk rather than a real parser: the input is
    this generator's own output, whose shape is fixed.
    """
    numbers: dict[str, int] = {}
    stack: list[str] = []
    for line in proto_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("message "):
            stack.append(stripped.split()[1])
            continue
        if stripped.startswith("}") and stack:
            stack.pop()
            continue
        match = re.match(r"(?:optional|repeated)\s+\S+\s+(\S+)\s*=\s*(\d+);", stripped)
        if match and stack:
            numbers[f"{stack[-1]}.{match.group(1)}"] = int(match.group(2))
    return numbers


class TestFieldNumberLock:
    """Field numbers are the wire identity on a schema-bound topic.

    The pubsub-cdc proto travels as binary against a Pub/Sub topic schema, so a
    consumer decodes by field number, not name. Numbering by position would make
    appending a column safe but inserting or reordering one silently
    destructive. The lock removes position from the equation.
    """

    def _numbers(self, proto_text: str) -> dict[str, int]:
        found: dict[str, int] = {}
        stack: list[str] = []
        for line in proto_text.splitlines():
            stripped = line.strip()
            if stripped.startswith("message "):
                stack.append(stripped.split()[1])
                continue
            if stripped.startswith("}") and stack:
                stack.pop()
                continue
            match = re.match(
                r"(?:optional|repeated)\s+\S+\s+(\S+)\s*=\s*(\d+);", stripped
            )
            if match and stack:
                found[f"{stack[-1]}.{match.group(1)}"] = int(match.group(2))
        return found

    def test_reordering_columns_does_not_move_field_numbers(self):
        """The failure mode this exists to prevent."""
        schema = json.loads(BQ_SCHEMA_PATH.read_text())["schema"]
        lock = generate_proto.load_field_numbers()

        baseline = self._numbers(generate(profile=PUBSUB_CDC, numbers=dict(lock)))

        # Move a column from the end to the front — the worst case for
        # positional numbering, which would shift every field after it.
        reordered = [schema[-1], *schema[:-1]]
        shuffled_path = BQ_SCHEMA_PATH.parent / "_reordered.json"
        shuffled_path.write_text(json.dumps({"schema": reordered}))
        try:
            after = self._numbers(
                generate(shuffled_path, profile=PUBSUB_CDC, numbers=dict(lock))
            )
        finally:
            shuffled_path.unlink()

        moved = {
            k: (baseline[k], after[k]) for k in baseline if after.get(k) != baseline[k]
        }
        assert not moved, f"reordering moved these field numbers: {moved}"

    def test_a_new_column_gets_a_fresh_number_and_disturbs_nothing(self):
        schema = json.loads(BQ_SCHEMA_PATH.read_text())["schema"]
        lock = generate_proto.load_field_numbers()
        baseline = self._numbers(generate(profile=PUBSUB_CDC, numbers=dict(lock)))

        grown = [*schema, {"name": "brand_new", "type": "STRING", "mode": "NULLABLE"}]
        grown_path = BQ_SCHEMA_PATH.parent / "_grown.json"
        grown_path.write_text(json.dumps({"schema": grown}))
        try:
            after = self._numbers(
                generate(grown_path, profile=PUBSUB_CDC, numbers=dict(lock))
            )
        finally:
            grown_path.unlink()

        assert "ActivityRow.brand_new" in after
        assert after["ActivityRow.brand_new"] not in baseline.values()
        moved = {
            k: (baseline[k], after[k]) for k in baseline if after.get(k) != baseline[k]
        }
        assert not moved, f"adding a column moved these field numbers: {moved}"

    def test_allocation_never_lands_on_a_pinned_cdc_number(self):
        numbers = {"ActivityRow.a": 997}
        allocated = generate_proto._locked_number(numbers, "ActivityRow", "b")
        assert allocated not in (998, 999)

    def test_the_committed_proto_matches_the_committed_lock(self):
        numbers = self._numbers(generate(profile=PUBSUB_CDC))
        lock = generate_proto.load_field_numbers()
        for key, value in lock.items():
            if key in numbers:
                assert numbers[key] == value, f"{key} drifted from the lock"


class TestLiveTableSchema:
    """The CDC table cannot declare REQUIRED columns beyond its primary key.

    Two independent reasons, both found in prod: a CDC delete carries only the
    key, so under use_table_schema any REQUIRED column rejects it; and under
    use_topic_schema Pub/Sub compares the schemas statically, where every
    proto2 field is `optional`, so a REQUIRED column at any depth fails the
    subscription update with INCOMPATIBLE_MODE.
    """

    def _required_paths(self, fields: list[dict], prefix: str = "") -> list[str]:
        found = []
        for field in fields:
            path = f"{prefix}{field['name']}"
            if field.get("mode") == "REQUIRED":
                found.append(path)
            if field.get("fields"):
                found += self._required_paths(field["fields"], path + ".")
        return found

    def test_only_the_primary_key_stays_required(self):
        """BigQuery refuses to relax a key column on an existing table:

            Key column id cannot be modified or removed.
            column's mode changed: REQUIRED -> NULLABLE

        So the key stays REQUIRED and the CDC proto labels it `required` to
        match. Everything else relaxes.
        """
        schema = json.loads(BQ_SCHEMA_PATH.read_text())["schema"]
        assert self._required_paths(generate_proto.relax_schema(schema)) == ["id"]

    def test_the_cdc_proto_marks_the_primary_key_required(self):
        """The other half of that agreement — without it the modes disagree
        and Pub/Sub rejects the subscription with INCOMPATIBLE_MODE."""
        content = generate(profile=PUBSUB_CDC)
        assert "required int64 id = 1;" in content
        # Nested records have their own `id`; only the row's key is required.
        assert content.count("required ") == 1

    def test_the_storage_write_proto_has_no_required_fields(self):
        """Storage Write wants every field optional; only the CDC profile
        carries the label."""
        assert "required " not in generate(profile=STORAGE_WRITE)

    def test_nested_required_fields_are_relaxed(self):
        """The case that broke the dev apply: `laps.start_date`."""
        schema = json.loads(BQ_SCHEMA_PATH.read_text())["schema"]
        source_nested = [p for p in self._required_paths(schema) if "." in p]
        assert source_nested, "fixture no longer exercises nested REQUIRED fields"
        assert "laps.start_date" in source_nested

        relaxed = generate_proto.relax_schema(schema)
        assert not [p for p in self._required_paths(relaxed) if "." in p]

    def test_repeated_is_left_alone(self):
        """REPEATED is cardinality, not nullability; proto `repeated` matches it."""
        schema = json.loads(BQ_SCHEMA_PATH.read_text())["schema"]
        before = {f["name"] for f in schema if f.get("mode") == "REPEATED"}
        after = {
            f["name"]
            for f in generate_proto.relax_schema(schema)
            if f.get("mode") == "REPEATED"
        }
        assert before, "fixture no longer exercises REPEATED fields"
        assert before == after

    def test_the_committed_live_schema_matches(self):
        schema = json.loads(BQ_SCHEMA_PATH.read_text())["schema"]
        committed = json.loads(generate_proto.LIVE_SCHEMA_PATH.read_text())["schema"]
        assert committed == generate_proto.relax_schema(schema)
