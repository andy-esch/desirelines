"""Unit tests for the production BigQuery Storage Write API wrapper.

Four layers of coverage:

1. **Type-mapping unit tests** — coercion helper, ISO→micros encoding.
2. **Schema-parity tests** — walk ``activities_full.json`` against the
   generated ``bq_activities_pb2.Activity`` descriptor and the
   hand-maintained ``_TIMESTAMP_PATHS`` set. Catches drift between the
   BQ JSON schema and the generated proto, AND drift between the BQ
   schema's TIMESTAMP columns and the wrapper's timestamp set.
3. **Round-trip tests** — load a real ``DetailedStravaActivity`` fixture,
   serialize via the wrapper, parse back, assert key fields preserve.
4. **Wrapper class behavior** — write_activity calls the underlying
   AppendRowsStream in the right order with close-on-failure semantics.
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from google.protobuf.descriptor import FieldDescriptor
import pytest

from stravapipe.adapters.gcp._bigquery_storage_v2 import (
    _TIMESTAMP_PATHS,
    BigQueryStorageWriterV2,
    _coerce_to_proto_type,
    _iso_to_micros,
    _populate_message,
)
from stravapipe.domain import DetailedStravaActivity
from stravapipe.types.generated import bq_activities_pb2

_FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def _load_activity(name: str) -> DetailedStravaActivity:
    with (_FIXTURES / name).open() as f:
        return DetailedStravaActivity.model_validate(json.load(f))


def _load_bq_schema() -> list[dict]:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "schemas" / "bigquery" / "activities_full.json"
        if candidate.exists():
            return json.loads(candidate.read_text())["schema"]
    raise FileNotFoundError("activities_full.json not found")


def _iter_bq_schema_paths(schema: list[dict], *, path: str = ""):
    """Yield ``(dotted_path, field_dict)`` for every leaf in a BQ schema."""
    for col in schema:
        field_path = f"{path}.{col['name']}" if path else col["name"]
        if col["type"] == "RECORD":
            yield from _iter_bq_schema_paths(col["fields"], path=field_path)
        else:
            yield field_path, col


def _find_proto_field_at_path(descriptor, path: str):
    """Walk a dotted path through nested proto messages."""
    parts = path.split(".")
    current = descriptor
    for i, part in enumerate(parts):
        field = next((f for f in current.fields if f.name == part), None)
        if field is None:
            return None
        if i == len(parts) - 1:
            return field
        if field.type != FieldDescriptor.TYPE_MESSAGE:
            return None
        current = field.message_type
    return None


class TestCoercion:
    def test_coerce_int_to_string(self):
        # The motivating case: workout_type comes from Strava as int but
        # the BQ schema declares STRING. insertAll silently coerced;
        # Storage Write doesn't, so we coerce explicitly.
        assert _coerce_to_proto_type(10, FieldDescriptor.TYPE_STRING) == "10"

    def test_coerce_string_to_int(self):
        assert _coerce_to_proto_type("42", FieldDescriptor.TYPE_INT64) == 42

    def test_coerce_int_to_double(self):
        assert _coerce_to_proto_type(7, FieldDescriptor.TYPE_DOUBLE) == 7.0

    def test_coerce_passthrough_unknown_type(self):
        assert _coerce_to_proto_type(b"raw", FieldDescriptor.TYPE_BYTES) == b"raw"


class TestIsoToMicros:
    def test_z_suffix(self):
        assert _iso_to_micros("2018-02-16T14:52:54Z") == 1518792774000000

    def test_explicit_offset(self):
        assert _iso_to_micros("2018-02-16T14:52:54+00:00") == 1518792774000000

    def test_naive_treated_as_utc(self):
        assert _iso_to_micros("2018-02-16T14:52:54") == 1518792774000000

    def test_offset_converts_to_utc(self):
        result = _iso_to_micros("2018-02-16T14:52:54-08:00")
        assert result == _iso_to_micros("2018-02-16T22:52:54Z")


class TestSchemaParity:
    """Catches drift between the BQ JSON schema and the generated proto.

    The generated proto is rebuilt by ``just generate-bq-proto`` and
    committed. If the JSON changes but the proto isn't regenerated,
    these tests fail. If the proto is regenerated but the wrapper's
    ``_TIMESTAMP_PATHS`` isn't updated, the timestamp test fails.

    These are the safety nets that make a hand-maintained
    ``_TIMESTAMP_PATHS`` safe.
    """

    def test_every_bq_field_has_matching_proto_field(self):
        bq_schema = _load_bq_schema()
        missing: list[str] = []
        for path, _col in _iter_bq_schema_paths(bq_schema):
            if _find_proto_field_at_path(
                bq_activities_pb2.Activity.DESCRIPTOR, path
            ) is None:
                missing.append(path)
        assert not missing, (
            f"BQ fields with no matching proto field: {missing}. "
            "Run `just generate-bq-proto` to regenerate."
        )

    def test_timestamp_paths_set_matches_bq_schema(self):
        bq_schema = _load_bq_schema()
        bq_timestamps = {
            path
            for path, col in _iter_bq_schema_paths(bq_schema)
            if col["type"] == "TIMESTAMP"
        }
        assert bq_timestamps == set(_TIMESTAMP_PATHS), (
            "_TIMESTAMP_PATHS in _bigquery_storage_v2.py diverges from "
            "BQ schema TIMESTAMP columns.\n"
            f"In BQ but not in set: {bq_timestamps - set(_TIMESTAMP_PATHS)}\n"
            f"In set but not in BQ: {set(_TIMESTAMP_PATHS) - bq_timestamps}"
        )

    def test_repeated_modes_match(self):
        bq_schema = _load_bq_schema()
        mismatches: list[str] = []
        for path, col in _iter_bq_schema_paths(bq_schema):
            field = _find_proto_field_at_path(
                bq_activities_pb2.Activity.DESCRIPTOR, path
            )
            if field is None:
                continue
            bq_repeated = col["mode"] == "REPEATED"
            proto_repeated = field.is_repeated
            if bq_repeated != proto_repeated:
                mismatches.append(
                    f"{path}: BQ repeated={bq_repeated}, "
                    f"proto repeated={proto_repeated}"
                )
        assert not mismatches, "REPEATED mode mismatches: " + "; ".join(mismatches)


class TestRoundTrip:
    def test_activity_1_round_trips(self):
        activity = _load_activity("activity_1.json")
        msg = bq_activities_pb2.Activity()
        _populate_message(msg, activity.model_dump(mode="json"))
        raw = msg.SerializeToString()
        parsed = bq_activities_pb2.Activity.FromString(raw)

        assert parsed.SerializeToString() == raw
        assert parsed.id == activity.id
        assert parsed.name == activity.name
        assert parsed.sport_type == activity.sport_type
        assert parsed.distance == pytest.approx(activity.distance)
        assert parsed.moving_time == activity.moving_time
        assert parsed.athlete.id == activity.athlete.id
        assert parsed.start_date == _iso_to_micros(activity.start_date.isoformat())

    def test_activity_2_round_trips(self):
        activity = _load_activity("activity_2.json")
        msg = bq_activities_pb2.Activity()
        _populate_message(msg, activity.model_dump(mode="json"))
        raw = msg.SerializeToString()
        parsed = bq_activities_pb2.Activity.FromString(raw)
        assert parsed.SerializeToString() == raw
        assert parsed.id == activity.id
        assert parsed.name == activity.name

    def test_workout_type_int_coerces_to_string(self):
        """Pydantic↔BQ drift bug found during research: Strava sends int,
        BQ schema declares STRING. Coercion handles it."""
        activity = _load_activity("activity_1.json").model_copy(
            update={"workout_type": 10}
        )
        msg = bq_activities_pb2.Activity()
        _populate_message(msg, activity.model_dump(mode="json"))
        assert msg.workout_type == "10"

    def test_repeated_record_round_trips(self):
        activity = _load_activity("activity_1.json")
        msg = bq_activities_pb2.Activity()
        _populate_message(msg, activity.model_dump(mode="json"))
        if activity.laps:
            assert len(msg.laps) == len(activity.laps)
            assert msg.laps[0].distance == pytest.approx(activity.laps[0].distance)
        if activity.segment_efforts:
            assert len(msg.segment_efforts) == len(activity.segment_efforts)

    def test_nullable_fields_left_unset(self):
        """None-valued NULLABLE fields must NOT be set on the proto.

        Setting an int field to 0 sends '0' on the wire; BQ stores NOT NULL.
        """
        activity = _load_activity("activity_1.json").model_copy(
            update={"workout_type": None, "kilojoules": None}
        )
        msg = bq_activities_pb2.Activity()
        _populate_message(msg, activity.model_dump(mode="json"))
        assert not msg.HasField("workout_type")
        assert not msg.HasField("kilojoules")

    def test_repeated_scalar_round_trips(self):
        """start_latlng is REPEATED FLOAT — list of floats round-trip intact."""
        activity = _load_activity("activity_1.json")
        msg = bq_activities_pb2.Activity()
        _populate_message(msg, activity.model_dump(mode="json"))
        assert list(msg.start_latlng) == list(activity.start_latlng)


class TestWrapperClass:
    @patch("stravapipe.adapters.gcp._bigquery_storage_v2.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage_v2.BigQueryWriteClient")
    def test_write_activity_calls_send_then_close(
        self, mock_client_class, mock_stream_class
    ):
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_client.table_path.return_value = "projects/p/datasets/d/tables/t"

        mock_stream = MagicMock()
        mock_stream_class.return_value = mock_stream
        mock_future = MagicMock()
        mock_stream.send.return_value = mock_future

        wrapper = BigQueryStorageWriterV2(
            project_id="p", dataset_name="d", table_name="t"
        )
        wrapper.write_activity(_load_activity("activity_1.json"))

        mock_stream.send.assert_called_once()
        mock_future.result.assert_called_once()
        mock_stream.close.assert_called_once()

    @patch("stravapipe.adapters.gcp._bigquery_storage_v2.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage_v2.BigQueryWriteClient")
    def test_close_runs_even_on_failure(
        self, mock_client_class, mock_stream_class
    ):
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_client.table_path.return_value = "projects/p/datasets/d/tables/t"

        mock_stream = MagicMock()
        mock_stream_class.return_value = mock_stream
        mock_future = MagicMock()
        mock_future.result.side_effect = RuntimeError("simulated gRPC error")
        mock_stream.send.return_value = mock_future

        wrapper = BigQueryStorageWriterV2(
            project_id="p", dataset_name="d", table_name="t"
        )
        with pytest.raises(RuntimeError, match="simulated gRPC error"):
            wrapper.write_activity(_load_activity("activity_1.json"))

        mock_stream.close.assert_called_once()

    @patch("stravapipe.adapters.gcp._bigquery_storage_v2.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage_v2.BigQueryWriteClient")
    def test_default_stream_path_format(self, mock_client_class, mock_stream_class):
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_client.table_path.return_value = (
            "projects/myp/datasets/myd/tables/myt"
        )
        mock_stream_class.return_value = MagicMock()

        wrapper = BigQueryStorageWriterV2(
            project_id="myp", dataset_name="myd", table_name="myt"
        )
        assert wrapper._default_stream() == (
            "projects/myp/datasets/myd/tables/myt/streams/_default"
        )


def test_start_date_local_naive_handling_matches_z_suffix():
    """Whether Strava sends with Z, with offset, or naive, the encoded
    micros should be the same wall-clock value."""
    z = _iso_to_micros("2018-02-16T14:52:54Z")
    naive = _iso_to_micros("2018-02-16T14:52:54")
    assert z == naive
