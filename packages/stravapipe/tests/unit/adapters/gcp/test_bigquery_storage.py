"""Unit tests for the experimental Storage Write API wrapper.

Tests focus on:
- Schema descriptor builds correctly (subset of activity fields).
- Activity → protobuf serialization round-trips.
- Optional-field handling (missing distance, missing athlete, string vs
  datetime start_date).
- write_activity calls the underlying AppendRowsStream in the right order
  and propagates underlying errors so callers can swallow them.
"""

from datetime import UTC, datetime
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from stravapipe.adapters.gcp._bigquery_storage import (
    _MESSAGE_CLASS,
    BigQueryStorageWriter,
    _build_descriptor,
    _to_iso_string,
)
from stravapipe.domain import DetailedStravaActivity

_FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def _load_activity_1() -> DetailedStravaActivity:
    """Load the canonical activity_1 fixture."""
    with (_FIXTURES / "activity_1.json").open() as f:
        return DetailedStravaActivity.model_validate(json.load(f))


class TestDescriptorAndSerialization:
    def test_descriptor_has_expected_fields(self):
        descriptor = _build_descriptor()
        field_names = {f.name for f in descriptor.field}
        assert field_names == {
            "id",
            "name",
            "sport_type",
            "start_date",
            "distance",
            "moving_time",
            "athlete_id",
        }

    def test_descriptor_id_is_required(self):
        descriptor = _build_descriptor()
        id_field = next(f for f in descriptor.field if f.name == "id")
        # LABEL_REQUIRED == 2 in the FieldDescriptorProto enum
        assert id_field.label == 2

    def test_serialize_activity_round_trips_through_descriptor(self):
        activity = _load_activity_1()
        with patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient"):
            writer = BigQueryStorageWriter(
                project_id="p", dataset_name="d", table_name="t"
            )
            payload = writer._serialize_activity(activity)

        # Parse the bytes back through the same message class
        parsed = _MESSAGE_CLASS()
        parsed.ParseFromString(payload)
        assert parsed.id == activity.id
        assert parsed.name == activity.name
        assert parsed.sport_type == activity.sport_type
        assert parsed.distance == pytest.approx(float(activity.distance))
        assert parsed.moving_time == int(activity.moving_time)
        assert parsed.athlete_id == int(activity.athlete.id)
        # start_date encoded as ISO string
        assert parsed.start_date == activity.start_date.isoformat()

    def test_serialize_activity_with_missing_optional_fields(self):
        """None on optional fields should not error and should not set them."""
        activity = _load_activity_1()
        # Force optional fields to None
        activity = activity.model_copy(
            update={"distance": None, "moving_time": None, "name": None}
        )

        with patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient"):
            writer = BigQueryStorageWriter(
                project_id="p", dataset_name="d", table_name="t"
            )
            payload = writer._serialize_activity(activity)

        parsed = _MESSAGE_CLASS()
        parsed.ParseFromString(payload)
        assert parsed.id == activity.id
        # In proto2 with optional fields, missing fields don't appear set
        assert not parsed.HasField("distance")
        assert not parsed.HasField("moving_time")
        assert not parsed.HasField("name")
        # Required field still set
        assert parsed.HasField("id")

    def test_to_iso_string_handles_datetime_and_none(self):
        assert _to_iso_string(None) is None
        dt = datetime(2026, 5, 5, 12, 0, 0, tzinfo=UTC)
        assert _to_iso_string(dt) == "2026-05-05T12:00:00+00:00"


class TestWriteActivity:
    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_write_activity_calls_send_then_close(
        self, mock_client_class, mock_stream_class
    ):
        """Verify the happy-path call order and that close() always runs."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_client.table_path.return_value = "projects/p/datasets/d/tables/t"

        mock_stream = MagicMock()
        mock_stream_class.return_value = mock_stream
        mock_future = MagicMock()
        mock_stream.send.return_value = mock_future

        writer = BigQueryStorageWriter(project_id="p", dataset_name="d", table_name="t")
        writer.write_activity(_load_activity_1())

        # Sequence: send → future.result → close
        mock_stream.send.assert_called_once()
        mock_future.result.assert_called_once()
        mock_stream.close.assert_called_once()

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_write_activity_closes_stream_even_on_failure(
        self, mock_client_class, mock_stream_class
    ):
        """If future.result() raises, stream.close() must still run.

        This matters because a leaked AppendRowsStream holds a gRPC
        connection. Caller in bq_inserter swallows the raised exception
        but expects no resource leaks.
        """
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_client.table_path.return_value = "projects/p/datasets/d/tables/t"

        mock_stream = MagicMock()
        mock_stream_class.return_value = mock_stream
        mock_future = MagicMock()
        mock_future.result.side_effect = RuntimeError("simulated gRPC error")
        mock_stream.send.return_value = mock_future

        writer = BigQueryStorageWriter(project_id="p", dataset_name="d", table_name="t")
        with pytest.raises(RuntimeError, match="simulated gRPC error"):
            writer.write_activity(_load_activity_1())

        mock_stream.close.assert_called_once()

    @patch("stravapipe.adapters.gcp._bigquery_storage.writer.AppendRowsStream")
    @patch("stravapipe.adapters.gcp._bigquery_storage.BigQueryWriteClient")
    def test_default_stream_path_format(self, mock_client_class, mock_stream_class):
        """The Storage Write API expects '<table_path>/streams/_default'."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_client.table_path.return_value = "projects/myp/datasets/myd/tables/myt"
        mock_stream_class.return_value = MagicMock()

        writer = BigQueryStorageWriter(
            project_id="myp", dataset_name="myd", table_name="myt"
        )
        assert writer._default_stream() == (
            "projects/myp/datasets/myd/tables/myt/streams/_default"
        )
