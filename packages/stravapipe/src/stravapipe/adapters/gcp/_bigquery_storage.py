"""BigQuery Storage Write API adapter (experimental, dual-write spike).

Spike-scoped wrapper that writes a subset of activity fields to a temp table
via the Storage Write API's default stream. Used by `bq_inserter` to dual-
write alongside the legacy `insert_rows_json` path so we can compare
behavior in production before committing to a full migration.

Scope decisions (see spike task Retro for rationale):

- **Subset schema**: writes 7 fields (id, name, sport_type, start_date,
  distance, moving_time, athlete_id) rather than the full 204-field
  `activities_full.json` schema. Sufficient for row-count and spot-check
  validation; the full-schema mapping is Stage 1's concern.
- **Dynamic protobuf descriptor**: schema is defined inline via
  `descriptor_pb2` rather than a static `.proto` file. Self-contained,
  no compilation step in the build.
- **Default stream**: matches `insert_rows_json`'s fire-and-forget
  semantics. No offset management, no commit step.
- **Per-call streams**: each `write_activity` call opens and closes its
  own `AppendRowsStream`. Simpler than long-lived streams; latency cost
  is expected to be the main thing the experiment surfaces.

After Stage 1 cuts over, this module is replaced by a production wrapper
with full schema parity. After Stage 2 it's deleted entirely.
"""

from datetime import datetime
import logging
from typing import Any

from google.cloud.bigquery_storage_v1 import BigQueryWriteClient, types, writer
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

from stravapipe.domain import DetailedStravaActivity

logger = logging.getLogger(__name__)


# Field numbers are arbitrary but stable: the BigQuery Storage Write API
# matches by name, not by tag, so these need only be unique within the
# message. We use 1..N for clarity.
_FIELD_NUMBERS = {
    "id": 1,
    "name": 2,
    "sport_type": 3,
    "start_date": 4,
    "distance": 5,
    "moving_time": 6,
    "athlete_id": 7,
}


def _build_descriptor() -> descriptor_pb2.DescriptorProto:
    """Build the protobuf descriptor for the experiment subset schema.

    Returns a DescriptorProto matching this BigQuery table schema:

      id            INT64    REQUIRED
      name          STRING   NULLABLE
      sport_type    STRING   NULLABLE
      start_date    STRING   NULLABLE  (ISO 8601; BigQuery TIMESTAMP coerces)
      distance      FLOAT64  NULLABLE
      moving_time   INT64    NULLABLE
      athlete_id    INT64    NULLABLE

    `start_date` is sent as ISO-8601 STRING because BigQuery accepts it as a
    TIMESTAMP coercion, and string-based timestamp transport sidesteps the
    proto2 timestamp-encoding problem during the spike. If we promote to
    Stage 1, we'll switch to a proper TIMESTAMP encoding.
    """
    proto = descriptor_pb2.DescriptorProto()
    proto.name = "ActivityExperiment"

    def _add_field(
        name: str,
        ftype: int,
        label: int = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL,
    ) -> None:
        f = proto.field.add()
        f.name = name
        f.number = _FIELD_NUMBERS[name]
        # protobuf stubs declare these as the generated enum type; the
        # int values match the enum's numeric domain, but the stubs reject
        # int assignment. Casting at the boundary is the standard idiom.
        f.type = ftype  # type: ignore[assignment]
        f.label = label  # type: ignore[assignment]

    # id is the only REQUIRED field (matches BigQuery schema)
    _add_field(
        "id",
        descriptor_pb2.FieldDescriptorProto.TYPE_INT64,
        label=descriptor_pb2.FieldDescriptorProto.LABEL_REQUIRED,
    )
    _add_field("name", descriptor_pb2.FieldDescriptorProto.TYPE_STRING)
    _add_field("sport_type", descriptor_pb2.FieldDescriptorProto.TYPE_STRING)
    _add_field("start_date", descriptor_pb2.FieldDescriptorProto.TYPE_STRING)
    _add_field("distance", descriptor_pb2.FieldDescriptorProto.TYPE_DOUBLE)
    _add_field("moving_time", descriptor_pb2.FieldDescriptorProto.TYPE_INT64)
    _add_field("athlete_id", descriptor_pb2.FieldDescriptorProto.TYPE_INT64)

    return proto


def _build_message_class() -> type[Any]:
    """Build a protobuf message class from the descriptor.

    Uses a dedicated descriptor pool to avoid collisions with other
    dynamically-built messages in the process. The returned class is used
    to instantiate, populate, and serialize each row.

    Return type is `type[Any]`: the class is a subclass of
    `google.protobuf.message.Message` at runtime, but mypy can't know
    about the dynamically-attached fields (id, name, etc.). Honest
    signal that we lose static type safety here — accessor errors
    surface at runtime as `AttributeError`.
    """
    descriptor = _build_descriptor()

    file_proto = descriptor_pb2.FileDescriptorProto()
    file_proto.name = "stravapipe/experiment.proto"
    file_proto.package = "stravapipe.experiment"
    file_proto.syntax = "proto2"
    file_proto.message_type.add().CopyFrom(descriptor)

    pool = descriptor_pool.DescriptorPool()
    pool.Add(file_proto)
    msg_descriptor = pool.FindMessageTypeByName(
        "stravapipe.experiment.ActivityExperiment"
    )
    return message_factory.GetMessageClass(msg_descriptor)


# Module-level so we build the descriptor + message class once per process.
_MESSAGE_CLASS = _build_message_class()


def _to_iso_string(dt: datetime | None) -> str | None:
    """Render an optional datetime as an ISO-8601 string."""
    return dt.isoformat() if dt is not None else None


class BigQueryStorageWriter:
    """Writes activities to BigQuery via Storage Write API default stream.

    Spike-scoped: writes the subset schema only. Each `write_activity`
    call uses a fresh AppendRowsStream — simpler than reusing connections
    for the spike, at some latency cost (which is part of what we're
    measuring).
    """

    def __init__(
        self,
        *,
        project_id: str,
        dataset_name: str,
        table_name: str,
    ):
        self._project_id = project_id
        self._dataset_name = dataset_name
        self._table_name = table_name
        # google-cloud-bigquery-storage stubs are incomplete (the client
        # constructor isn't typed). Suppression bounded to this call.
        self._client = BigQueryWriteClient()  # type: ignore[no-untyped-call]
        # Schema and stream path don't change per call — build the request
        # template once and reuse for every AppendRowsStream we open.
        self._request_template = self._build_request_template()

    def _table_path(self) -> str:
        return self._client.table_path(
            self._project_id, self._dataset_name, self._table_name
        )

    def _default_stream(self) -> str:
        return f"{self._table_path()}/streams/_default"

    def _build_request_template(self) -> types.AppendRowsRequest:
        request = types.AppendRowsRequest()
        request.write_stream = self._default_stream()

        proto_schema = types.ProtoSchema()
        descriptor = descriptor_pb2.DescriptorProto()
        _MESSAGE_CLASS.DESCRIPTOR.CopyToProto(descriptor)
        proto_schema.proto_descriptor = descriptor

        proto_data = types.AppendRowsRequest.ProtoData()
        proto_data.writer_schema = proto_schema
        request.proto_rows = proto_data
        return request

    def _serialize_activity(self, activity: DetailedStravaActivity) -> bytes:
        """Map activity fields onto the proto message and serialize."""
        msg = _MESSAGE_CLASS()
        msg.id = activity.id
        if activity.name is not None:
            msg.name = activity.name
        if activity.sport_type is not None:
            msg.sport_type = activity.sport_type
        start_date_str = _to_iso_string(activity.start_date)
        if start_date_str is not None:
            msg.start_date = start_date_str
        if activity.distance is not None:
            msg.distance = float(activity.distance)
        if activity.moving_time is not None:
            msg.moving_time = int(activity.moving_time)
        if activity.athlete is not None and activity.athlete.id is not None:
            msg.athlete_id = int(activity.athlete.id)
        # SerializeToString returns bytes per protobuf contract; stub
        # returns Any, so explicit cast at the boundary.
        return bytes(msg.SerializeToString())

    def write_activity(self, activity: DetailedStravaActivity) -> None:
        """Write a single activity to the experiment table.

        Raises on any underlying gRPC or schema error — the caller in
        bq_inserter._handle_create wraps this in a try/except that NEVER
        propagates failures back into the production write path.
        """
        serialized = self._serialize_activity(activity)

        append_stream = writer.AppendRowsStream(self._client, self._request_template)
        try:
            proto_rows = types.ProtoRows()
            proto_rows.serialized_rows.append(serialized)

            proto_data = types.AppendRowsRequest.ProtoData()
            proto_data.rows = proto_rows

            request = types.AppendRowsRequest()
            request.proto_rows = proto_data

            future = append_stream.send(request)
            # Block until BQ accepts (or rejects) the row. The default-stream
            # write is synchronous from the caller's POV; future.result()
            # raises on schema/permission errors and on transient gRPC
            # failures the underlying client didn't retry.
            future.result()  # type: ignore[no-untyped-call]
        finally:
            append_stream.close()
