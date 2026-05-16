"""Unit tests for the production BigQuery Storage Write API wrapper.

Five layers of coverage:

1. **Type-mapping unit tests** — coercion helper, ISO→micros encoding.
2. **Schema-parity tests** — walk ``activities_full.json`` against the
   generated ``bq_activities_pb2.Activity`` descriptor and the
   hand-maintained ``_TIMESTAMP_PATHS`` set. Catches drift between the
   BQ JSON schema and the generated proto, AND drift between the BQ
   schema's TIMESTAMP columns and the wrapper's timestamp set.
3. **Round-trip tests** — load a real ``DetailedStravaActivity`` fixture,
   serialize via the wrapper, parse back, assert key fields preserve.
4. **Wrapper class behavior** — write_activity / write_activities_batch
   build the right AppendRowsRequest and call the underlying stream.
5. **Stream reuse** — long-lived stream is shared across writes,
   dropped on failure, and closed idempotently on shutdown.
"""

from datetime import UTC, datetime
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from google.api_core.exceptions import Unknown
from google.cloud.bigquery_storage_v1.exceptions import StreamClosedError
from google.protobuf.descriptor import FieldDescriptor
import pytest

from stravapipe.adapters.gcp._bigquery_storage import (
    _TIMESTAMP_PATHS,
    BigQueryStorageWriter,
    _coerce_to_proto_type,
    _flatten_descriptor,
    _iso_to_micros,
    _normalize_name,
    _populate_message,
)
from stravapipe.domain import (
    DetailedStravaActivity,
    MetaAthlete,
    SummaryMap,
    SummaryStravaActivity,
)
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


_FAKE_STREAM = "projects/p/datasets/d/tables/t/streams/_default"


def _make_mock_client() -> MagicMock:
    """MagicMock satisfying ``BigQueryStorageWriter`` construction.

    ``proto-plus`` rejects MagicMock values for ``request.write_stream``
    (which must be a real string), so the helper pre-configures
    ``write_stream_path`` to return a fixed path. All wrapper-class
    tests use this to avoid each one duplicating the setup.
    """
    client = MagicMock()
    client.write_stream_path.return_value = _FAKE_STREAM
    return client


class TestCoercion:
    def test_coerce_int_to_string(self):
        # Motivating case: workout_type is `int` in Pydantic but `STRING`
        # in the BQ schema; Storage Write is strict about field types so
        # we coerce explicitly.
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
            if (
                _find_proto_field_at_path(bq_activities_pb2.Activity.DESCRIPTOR, path)
                is None
            ):
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
            "_TIMESTAMP_PATHS in _bigquery_storage.py diverges from "
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


class TestFlattenDescriptor:
    """The BQ Storage Write API rejects ``DescriptorProto``s that
    reference nested message types via fully-qualified paths it can't
    resolve in isolation. ``_flatten_descriptor`` inlines all dependent
    types as root-level siblings with normalized names — these tests
    pin down that contract."""

    def test_normalize_name_strips_leading_dot_and_replaces_dots(self):
        assert _normalize_name(".foo.Bar.Baz") == "foo_Bar_Baz"
        assert _normalize_name("foo.Bar") == "foo_Bar"
        assert _normalize_name("Single") == "Single"

    def test_flatten_produces_no_dotted_type_names(self):
        flat = _flatten_descriptor(bq_activities_pb2.Activity.DESCRIPTOR)

        def walk(desc):
            for f in desc.field:
                if f.type_name:
                    assert "." not in f.type_name, (
                        f"Field {f.name} has dotted type_name {f.type_name!r}; "
                        "flattening incomplete."
                    )
            for nt in desc.nested_type:
                walk(nt)

        walk(flat)

    def test_flatten_lifts_all_nested_types_to_root(self):
        """No nested_type entry should itself contain nested_types — all
        message types are flattened to a single level."""
        flat = _flatten_descriptor(bq_activities_pb2.Activity.DESCRIPTOR)
        for nt in flat.nested_type:
            assert len(nt.nested_type) == 0, (
                f"Nested type {nt.name} still has its own nested_types; "
                "flattening should produce a single level."
            )

    def test_flatten_root_name_is_normalized_full_name(self):
        flat = _flatten_descriptor(bq_activities_pb2.Activity.DESCRIPTOR)
        assert flat.name == "desirelines_bigquery_v1_Activity"

    def test_flatten_preserves_field_names_and_numbers(self):
        """BQ matches columns by field NAME, so field names must survive
        flattening unchanged. Field numbers preserve wire-format binding."""
        flat = _flatten_descriptor(bq_activities_pb2.Activity.DESCRIPTOR)
        original_fields = {
            f.name: f.number for f in bq_activities_pb2.Activity.DESCRIPTOR.fields
        }
        flat_fields = {f.name: f.number for f in flat.field}
        assert flat_fields == original_fields

    def test_flatten_dedupes_repeated_references_to_same_type(self):
        """If the same dependent type were referenced from multiple
        places (it isn't in our current schema, but the flattener
        should be safe for it), it should appear once in nested_type."""
        flat = _flatten_descriptor(bq_activities_pb2.Activity.DESCRIPTOR)
        names = [nt.name for nt in flat.nested_type]
        assert len(names) == len(set(names)), f"Duplicate nested type names: {names}"

    def test_flatten_emits_no_proto3_optional(self):
        """BQ Storage Write rejects descriptors carrying the
        ``[proto3_optional=true]`` annotation. Our generator emits
        ``syntax = "proto2"`` so the source descriptor never has this
        flag set, but verify the flattener also doesn't introduce it."""
        flat = _flatten_descriptor(bq_activities_pb2.Activity.DESCRIPTOR)

        def walk(desc):
            for f in desc.field:
                assert not f.proto3_optional, (
                    f"Field {desc.name}.{f.name} has proto3_optional=True; "
                    "BQ Storage Write will reject this descriptor."
                )
            for nt in desc.nested_type:
                walk(nt)

        walk(flat)


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
    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_write_activity_sends_one_request(
        self, mock_client_class, mock_stream_class
    ):
        mock_client_class.return_value = _make_mock_client()

        mock_stream = MagicMock()
        mock_stream_class.return_value = mock_stream
        mock_future = MagicMock()
        mock_stream.send.return_value = mock_future

        wrapper = BigQueryStorageWriter(
            project_id="p", dataset_name="d", table_name="t"
        )
        wrapper.write_activity(_load_activity("activity_1.json"))

        mock_stream.send.assert_called_once()
        mock_future.result.assert_called_once()
        # close is NOT called per-write; it's only called on wrapper.close().
        mock_stream.close.assert_not_called()

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_default_stream_path_format(self, mock_client_class, mock_stream_class):
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_client.write_stream_path.return_value = (
            "projects/myp/datasets/myd/tables/myt/streams/_default"
        )
        mock_stream_class.return_value = MagicMock()

        wrapper = BigQueryStorageWriter(
            project_id="myp", dataset_name="myd", table_name="myt"
        )
        assert wrapper._default_stream() == (
            "projects/myp/datasets/myd/tables/myt/streams/_default"
        )
        mock_client.write_stream_path.assert_called_with(
            "myp", "myd", "myt", "_default"
        )


class TestWrapperBatch:
    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_batch_sends_one_request_with_all_rows(
        self, mock_client_class, mock_stream_class
    ):
        mock_client_class.return_value = _make_mock_client()

        mock_stream = MagicMock()
        mock_stream_class.return_value = mock_stream
        mock_stream.send.return_value = MagicMock()

        wrapper = BigQueryStorageWriter(
            project_id="p", dataset_name="d", table_name="t"
        )
        activities = [
            _load_activity("activity_1.json"),
            _load_activity("activity_2.json"),
        ]
        wrapper.write_activities_batch(activities)

        # One AppendRows call carrying both serialized rows
        mock_stream.send.assert_called_once()
        sent_request = mock_stream.send.call_args.args[0]
        assert len(sent_request.proto_rows.rows.serialized_rows) == 2
        # Stream is reused; not closed per-batch.
        mock_stream.close.assert_not_called()

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_empty_batch_does_not_open_stream(
        self, mock_client_class, mock_stream_class
    ):
        mock_client_class.return_value = _make_mock_client()
        wrapper = BigQueryStorageWriter(
            project_id="p", dataset_name="d", table_name="t"
        )
        wrapper.write_activities_batch([])
        mock_stream_class.assert_not_called()


class TestStreamReuse:
    """Per Google's Storage Write API best practices, the writer holds
    one long-lived AppendRowsStream and reuses it across calls. These
    tests pin down that contract."""

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_two_writes_share_one_stream(self, mock_client_class, mock_stream_class):
        mock_client_class.return_value = _make_mock_client()
        mock_stream = MagicMock()
        mock_stream_class.return_value = mock_stream
        mock_stream.send.return_value = MagicMock()

        wrapper = BigQueryStorageWriter(
            project_id="p", dataset_name="d", table_name="t"
        )
        wrapper.write_activity(_load_activity("activity_1.json"))
        wrapper.write_activity(_load_activity("activity_2.json"))

        # AppendRowsStream constructed exactly once, send called twice.
        assert mock_stream_class.call_count == 1
        assert mock_stream.send.call_count == 2

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_send_failure_drops_stream_and_next_write_reopens(
        self, mock_client_class, mock_stream_class
    ):
        mock_client_class.return_value = _make_mock_client()
        first_stream = MagicMock(spec=["send", "close", "is_active"])
        second_stream = MagicMock(spec=["send", "close", "is_active"])
        mock_stream_class.side_effect = [first_stream, second_stream]

        # First call fails during result(); second call succeeds.
        failing_future = MagicMock()
        failing_future.result.side_effect = Unknown("open failed")
        first_stream.send.return_value = failing_future
        second_stream.send.return_value = MagicMock()

        wrapper = BigQueryStorageWriter(
            project_id="p", dataset_name="d", table_name="t"
        )
        with pytest.raises(Unknown, match="open failed"):
            wrapper.write_activity(_load_activity("activity_1.json"))
        # _drop_stream closed the bad stream.
        first_stream.close.assert_called_once()

        # Next call gets a brand new stream and succeeds.
        wrapper.write_activity(_load_activity("activity_2.json"))
        assert mock_stream_class.call_count == 2
        second_stream.send.assert_called_once()

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_drop_suppresses_stream_closed_error(
        self, mock_client_class, mock_stream_class
    ):
        """The lib's _open() may have already invoked self.close() with a
        reason if the open failed, leaving the stream in a closed state.
        Our drop path must not raise StreamClosedError on top of the
        original send failure."""
        mock_client_class.return_value = _make_mock_client()
        bad_stream = MagicMock(spec=["send", "close", "is_active"])
        good_stream = MagicMock(spec=["send", "close", "is_active"])
        mock_stream_class.side_effect = [bad_stream, good_stream]

        bad_stream.send.side_effect = Unknown("open failure")
        bad_stream.close.side_effect = StreamClosedError("already closed")
        good_stream.send.return_value = MagicMock()

        wrapper = BigQueryStorageWriter(
            project_id="p", dataset_name="d", table_name="t"
        )
        with pytest.raises(Unknown, match="open failure"):
            wrapper.write_activity(_load_activity("activity_1.json"))

        # Original Unknown propagates; StreamClosedError from the close
        # is swallowed.
        bad_stream.close.assert_called_once()

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_close_closes_the_active_stream(self, mock_client_class, mock_stream_class):
        mock_client_class.return_value = _make_mock_client()
        mock_stream = MagicMock()
        mock_stream_class.return_value = mock_stream
        mock_stream.send.return_value = MagicMock()

        wrapper = BigQueryStorageWriter(
            project_id="p", dataset_name="d", table_name="t"
        )
        wrapper.write_activity(_load_activity("activity_1.json"))
        wrapper.close()

        mock_stream.close.assert_called_once()

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_close_before_any_write_is_safe(self, mock_client_class, mock_stream_class):
        mock_client_class.return_value = _make_mock_client()
        wrapper = BigQueryStorageWriter(
            project_id="p", dataset_name="d", table_name="t"
        )
        wrapper.close()
        # No stream was ever opened.
        mock_stream_class.assert_not_called()

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_close_is_idempotent(self, mock_client_class, mock_stream_class):
        mock_client_class.return_value = _make_mock_client()
        mock_stream = MagicMock()
        mock_stream_class.return_value = mock_stream
        mock_stream.send.return_value = MagicMock()

        wrapper = BigQueryStorageWriter(
            project_id="p", dataset_name="d", table_name="t"
        )
        wrapper.write_activity(_load_activity("activity_1.json"))
        wrapper.close()
        wrapper.close()  # No-op second call.

        # close on the underlying stream happens exactly once.
        mock_stream.close.assert_called_once()


class TestDumpForBq:
    """The dump-shape decision (model_dump vs to_bq_dict) lives in the
    storage writer; verify both branches at the dict layer so the batch
    test doesn't have to reach into proto bytes."""

    def test_detailed_activity_uses_full_model_dump(self):
        activity = _load_activity("activity_1.json")
        dumped = BigQueryStorageWriter._dump_for_bq(activity)
        # DetailedStravaActivity matches BQ schema 1:1 — every dumped
        # key should also exist on the model.
        assert dumped["id"] == activity.id

    def test_summary_activity_excludes_non_bq_fields(self):
        summary = SummaryStravaActivity(
            id=42,
            resource_state=2,
            athlete=MetaAthlete(id=1, resource_state=1),
            name="x",
            type="Run",
            sport_type="Run",
            distance=1.0,
            moving_time=1,
            elapsed_time=1,
            total_elevation_gain=0.0,
            start_date=datetime(2025, 1, 1, tzinfo=UTC),
            start_date_local=datetime(2025, 1, 1, tzinfo=UTC),
            timezone="UTC",
            utc_offset=0.0,
            start_latlng=[0.0, 0.0],
            end_latlng=[0.0, 0.0],
            location_city="Berlin",
            achievement_count=0,
            kudos_count=0,
            comment_count=0,
            athlete_count=1,
            photo_count=0,
            has_kudoed=False,
            map=SummaryMap(id="x", summary_polyline="", resource_state=2),
            trainer=False,
            commute=False,
            manual=False,
            private=False,
            flagged=False,
            from_accepted_tag=False,
            average_speed=0.0,
            max_speed=0.0,
        )
        dumped = BigQueryStorageWriter._dump_for_bq(summary)
        # Fields excluded by SummaryStravaActivity._BQ_EXCLUDE_FIELDS must
        # not appear — they conflict with the BQ schema (e.g. top-level
        # `resource_state` collides with `athlete.resource_state`).
        for excluded in (
            "resource_state",
            "location_city",
            "location_state",
            "location_country",
            "from_accepted_tag",
            "utc_offset",
        ):
            assert excluded not in dumped
        assert dumped["id"] == 42


def test_start_date_local_naive_handling_matches_z_suffix():
    """Whether Strava sends with Z, with offset, or naive, the encoded
    micros should be the same wall-clock value."""
    z = _iso_to_micros("2018-02-16T14:52:54Z")
    naive = _iso_to_micros("2018-02-16T14:52:54")
    assert z == naive
