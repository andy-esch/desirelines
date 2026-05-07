"""Unit tests for the production BigQuery Storage Write API wrapper.

Three layers of coverage:

1. **Type-mapping unit tests** — descriptor builder, coercion helper,
   ISO→micros encoding. Pure-function unit tests.
2. **Schema-parity test** — walks `activities_full.json` against the
   built descriptor and asserts every BQ field is present. Catches
   schema drift before it hits prod.
3. **Round-trip tests** — load a real `DetailedStravaActivity` fixture,
   serialize via the wrapper, parse back, assert key fields preserve.
4. **Wrapper class behavior** — write_activity calls the underlying
   AppendRowsStream in the right order with close-on-failure
   semantics (mocked).
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from google.protobuf.descriptor import FieldDescriptor
import pytest

from stravapipe.adapters.gcp._bigquery_storage_v2 import (
    _MESSAGE_CLASS,
    _TIMESTAMP_PATHS,
    BigQueryStorageWriterV2,
    _coerce_to_proto_type,
    _iso_to_micros,
    _populate_message,
    iter_bq_schema_paths,
)
from stravapipe.domain import DetailedStravaActivity

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


# ---------------------------------------------------------------------------
# Type-mapping unit tests
# ---------------------------------------------------------------------------


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
        # TYPE_BYTES isn't in our schema; passthrough is the safe default.
        assert _coerce_to_proto_type(b"raw", FieldDescriptor.TYPE_BYTES) == b"raw"


class TestIsoToMicros:
    def test_z_suffix(self):
        # Strava's typical format: 2018-02-16T14:52:54Z
        assert _iso_to_micros("2018-02-16T14:52:54Z") == 1518792774000000

    def test_explicit_offset(self):
        # Equivalent to the Z-suffix case at the same UTC instant.
        assert _iso_to_micros("2018-02-16T14:52:54+00:00") == 1518792774000000

    def test_naive_treated_as_utc(self):
        # The "naive = UTC for storage" rule that matches insertAll's behavior.
        assert _iso_to_micros("2018-02-16T14:52:54") == 1518792774000000

    def test_offset_converts_to_utc(self):
        # 14:52:54 -08:00 == 22:52:54 UTC; should encode as the UTC instant.
        result = _iso_to_micros("2018-02-16T14:52:54-08:00")
        assert result == _iso_to_micros("2018-02-16T22:52:54Z")


# ---------------------------------------------------------------------------
# Schema-parity test (the headline new test from the research)
# ---------------------------------------------------------------------------


class TestSchemaParity:
    """Catches Pydantic ↔ BQ schema drift before it hits production.

    The motivating case is `workout_type`: Pydantic declares int, BQ
    declares STRING. Today the value mapper coerces and survives, but
    a future field with an unforeseen mismatch would fail silently
    until the first activity with that field arrives. This test surfaces
    drift as a CI failure.
    """

    def test_every_bq_field_has_matching_proto_field(self):
        """Every leaf field in activities_full.json must have a matching
        proto descriptor field at the corresponding path."""
        bq_schema = _load_bq_schema()
        missing: list[str] = []
        for path, _col in iter_bq_schema_paths(bq_schema):
            if not _proto_has_field_at_path(_MESSAGE_CLASS.DESCRIPTOR, path):
                missing.append(path)
        assert not missing, f"BQ fields with no matching proto field: {missing}"

    def test_all_bq_timestamps_recognized(self):
        """Every TIMESTAMP column in BQ must appear in the
        timestamp_paths set so the value mapper encodes it correctly."""
        bq_schema = _load_bq_schema()
        bq_timestamps = {
            path
            for path, col in iter_bq_schema_paths(bq_schema)
            if col["type"] == "TIMESTAMP"
        }
        assert bq_timestamps == set(_TIMESTAMP_PATHS), (
            f"timestamp_paths set diverges from BQ schema TIMESTAMP columns. "
            f"In BQ but not tracked: {bq_timestamps - set(_TIMESTAMP_PATHS)}. "
            f"Tracked but not in BQ: {set(_TIMESTAMP_PATHS) - bq_timestamps}."
        )

    def test_repeated_modes_match(self):
        """Every BQ REPEATED field must be REPEATED in the proto."""
        bq_schema = _load_bq_schema()
        mismatches: list[str] = []
        for path, col in iter_bq_schema_paths(bq_schema):
            field = _find_proto_field_at_path(_MESSAGE_CLASS.DESCRIPTOR, path)
            if field is None:
                continue  # covered by the parity test above
            bq_repeated = col["mode"] == "REPEATED"
            proto_repeated = field.is_repeated
            if bq_repeated != proto_repeated:
                mismatches.append(
                    f"{path}: BQ repeated={bq_repeated}, "
                    f"proto repeated={proto_repeated}"
                )
        assert not mismatches, "REPEATED mode mismatches: " + "; ".join(mismatches)


def _proto_has_field_at_path(descriptor, path: str) -> bool:
    """True if the proto descriptor has a field at the dotted BQ path."""
    return _find_proto_field_at_path(descriptor, path) is not None


def _find_proto_field_at_path(descriptor, path: str):
    """Walk a dotted path through nested proto messages; return the
    final FieldDescriptor or None if any segment is missing."""
    parts = path.split(".")
    current_descriptor = descriptor
    for i, part in enumerate(parts):
        field = next((f for f in current_descriptor.fields if f.name == part), None)
        if field is None:
            return None
        if i == len(parts) - 1:
            return field
        # Not the leaf — must be a message; descend into the nested type.
        if field.type != FieldDescriptor.TYPE_MESSAGE:
            return None
        current_descriptor = field.message_type
    return None


# ---------------------------------------------------------------------------
# Round-trip tests
# ---------------------------------------------------------------------------


class TestRoundTrip:
    def test_activity_1_round_trips(self):
        activity = _load_activity("activity_1.json")
        msg = _MESSAGE_CLASS()
        _populate_message(
            msg,
            activity.model_dump(mode="json"),
            timestamp_paths=_TIMESTAMP_PATHS,
        )
        raw = msg.SerializeToString()
        parsed = _MESSAGE_CLASS.FromString(raw)

        # Re-serializing the parsed message must produce identical bytes.
        assert parsed.SerializeToString() == raw

        # Spot-check key fields.
        assert parsed.id == activity.id
        assert parsed.name == activity.name
        assert parsed.sport_type == activity.sport_type
        assert parsed.distance == pytest.approx(activity.distance)
        assert parsed.moving_time == activity.moving_time
        assert parsed.athlete.id == activity.athlete.id
        # TIMESTAMP encoded as int64 micros.
        assert parsed.start_date == _iso_to_micros(activity.start_date.isoformat())

    def test_activity_2_round_trips(self):
        # Different fixture in case its null pattern differs.
        activity = _load_activity("activity_2.json")
        msg = _MESSAGE_CLASS()
        _populate_message(
            msg,
            activity.model_dump(mode="json"),
            timestamp_paths=_TIMESTAMP_PATHS,
        )
        raw = msg.SerializeToString()
        parsed = _MESSAGE_CLASS.FromString(raw)
        assert parsed.SerializeToString() == raw
        assert parsed.id == activity.id
        assert parsed.name == activity.name

    def test_workout_type_int_coerces_to_string(self):
        """Regression test: the Pydantic↔BQ drift bug found during research.

        Strava sends workout_type as int, BQ schema declares STRING.
        Without coercion, the value mapper raises TypeError. This test
        forces the coerce path by constructing an activity with a
        non-null workout_type.
        """
        activity = _load_activity("activity_1.json").model_copy(
            update={"workout_type": 10}
        )
        msg = _MESSAGE_CLASS()
        _populate_message(
            msg,
            activity.model_dump(mode="json"),
            timestamp_paths=_TIMESTAMP_PATHS,
        )
        # Coerced int → string.
        assert msg.workout_type == "10"

    def test_repeated_record_round_trips(self):
        """REPEATED RECORD fields like laps, segment_efforts must round-trip."""
        activity = _load_activity("activity_1.json")
        msg = _MESSAGE_CLASS()
        _populate_message(
            msg,
            activity.model_dump(mode="json"),
            timestamp_paths=_TIMESTAMP_PATHS,
        )
        if activity.laps:
            assert len(msg.laps) == len(activity.laps)
            assert msg.laps[0].distance == pytest.approx(activity.laps[0].distance)
        if activity.segment_efforts:
            assert len(msg.segment_efforts) == len(activity.segment_efforts)

    def test_nullable_fields_left_unset(self):
        """None-valued NULLABLE fields must NOT be set on the proto.

        Setting an int field to 0 sends '0' on the wire; BQ stores
        NOT NULL. The whole point of `if value is None: continue` is to
        preserve NULL semantics.
        """
        activity = _load_activity("activity_1.json").model_copy(
            update={"workout_type": None, "kilojoules": None}
        )
        msg = _MESSAGE_CLASS()
        _populate_message(
            msg,
            activity.model_dump(mode="json"),
            timestamp_paths=_TIMESTAMP_PATHS,
        )
        assert not msg.HasField("workout_type")
        assert not msg.HasField("kilojoules")

    def test_repeated_scalar_round_trips(self):
        """start_latlng is REPEATED FLOAT — list of floats round-trip intact."""
        activity = _load_activity("activity_1.json")
        msg = _MESSAGE_CLASS()
        _populate_message(
            msg,
            activity.model_dump(mode="json"),
            timestamp_paths=_TIMESTAMP_PATHS,
        )
        assert list(msg.start_latlng) == list(activity.start_latlng)


# ---------------------------------------------------------------------------
# Wrapper class behavior (mocked)
# ---------------------------------------------------------------------------


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
    def test_close_runs_even_on_failure(self, mock_client_class, mock_stream_class):
        """Stream must close even if future.result() raises — otherwise
        we'd leak gRPC connections under transient errors."""
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
        mock_client.table_path.return_value = "projects/myp/datasets/myd/tables/myt"
        mock_stream_class.return_value = MagicMock()

        wrapper = BigQueryStorageWriterV2(
            project_id="myp", dataset_name="myd", table_name="myt"
        )
        assert wrapper._default_stream() == (
            "projects/myp/datasets/myd/tables/myt/streams/_default"
        )


# ---------------------------------------------------------------------------
# Regression test for one specific finding in the research
# ---------------------------------------------------------------------------


def test_start_date_local_naive_handling_matches_z_suffix():
    """Whether Strava sends start_date_local with Z, with offset, or
    naive, the encoded micros should be the same wall-clock-time value
    (which is what BQ stores via TIMESTAMP coercion historically).

    This locks in the 'naive = UTC for storage' rule that the value
    mapper depends on. If someone refactors `_iso_to_micros` and
    accidentally treats naive as some other tz, this fails.
    """
    z = _iso_to_micros("2018-02-16T14:52:54Z")
    naive = _iso_to_micros("2018-02-16T14:52:54")
    assert z == naive
