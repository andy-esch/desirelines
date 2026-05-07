"""BigQuery Storage Write API adapter — production wrapper (full schema).

Companion to ``_bigquery_storage.py`` (the spike's 7-field subset wrapper).
This module ships the full 204-field mapping that matches
``schemas/bigquery/activities_full.json`` and is the wrapper Stage 1 will
swap into ``_write_to_staging`` once the spike's soak returns GO.

Until cutover, this module is **not imported by any production path**.
It coexists with the spike wrapper so reviewers can compare them and
the cutover is a one-line edit in ``bq_inserter_app.py``.

Architecture (see ``research/bq-storage-write-api-migration.md`` for full
rationale and verified findings):

- **Two pure pipelines.** A descriptor builder converts the BQ JSON
  schema to a ``descriptor_pb2.DescriptorProto``; a value mapper walks
  the resulting fields and pulls values from a ``DetailedStravaActivity``
  Pydantic model.
- **Strict type coercion at write time.** The legacy ``insertAll`` API
  silently coerces (e.g. ``int → STRING`` for ``workout_type``); Storage
  Write is strict. ``_coerce_to_proto_type`` replicates the legacy
  coercion explicitly so we don't crash on the first activity with a
  type-mismatched field.
- **TIMESTAMP via int64 microseconds.** BQ Storage Write expects raw
  micros-since-epoch, *not* the proto well-known ``Timestamp`` message.
  ``_iso_to_micros`` handles both tz-aware ISO strings (``start_date``,
  with ``Z`` or offset) and naive ones (``start_date_local``, treated as
  UTC for conversion — see comment there).
- **Default stream, per-call AppendRowsStream.** Same shape as the
  spike. Reuse-the-stream optimization is deferred to a future task if
  latency surprises us.
"""

from collections.abc import Iterable
from datetime import UTC, datetime
import json
import logging
from pathlib import Path
from typing import Any

from google.cloud.bigquery_storage_v1 import BigQueryWriteClient, types, writer
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory
from google.protobuf.descriptor import FieldDescriptor

from stravapipe.domain import DetailedStravaActivity

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Type mapping (BigQuery JSON schema → proto2)
# ---------------------------------------------------------------------------

# Maps BQ scalar types to proto2 field types. RECORD is handled separately
# in `_build_descriptor` via `nested_type` + `type_name`.
_BQ_TO_PROTO_SCALAR: dict[str, int] = {
    "INTEGER": descriptor_pb2.FieldDescriptorProto.TYPE_INT64,
    "FLOAT": descriptor_pb2.FieldDescriptorProto.TYPE_DOUBLE,
    "STRING": descriptor_pb2.FieldDescriptorProto.TYPE_STRING,
    "BOOLEAN": descriptor_pb2.FieldDescriptorProto.TYPE_BOOL,
    # TIMESTAMP encoded as int64 microseconds since Unix epoch (BQ Storage
    # Write API convention; *not* the proto well-known Timestamp message).
    "TIMESTAMP": descriptor_pb2.FieldDescriptorProto.TYPE_INT64,
    # JSON columns transport as STRING containing JSON-encoded text.
    "JSON": descriptor_pb2.FieldDescriptorProto.TYPE_STRING,
}

_BQ_MODE_TO_LABEL: dict[str, int] = {
    "REQUIRED": descriptor_pb2.FieldDescriptorProto.LABEL_REQUIRED,
    "NULLABLE": descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL,
    "REPEATED": descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED,
}


def _to_message_name(field_name: str) -> str:
    """Convert ``snake_case`` field name to ``PascalCase`` nested message name.

    Used so the BQ ``segment_efforts`` RECORD becomes a proto nested type
    ``SegmentEfforts`` (proto convention is PascalCase for messages).
    """
    return "".join(part.capitalize() for part in field_name.split("_"))


def _build_descriptor(
    schema: list[dict[str, Any]],
    *,
    name: str,
    parent_fqn: str,
    timestamp_paths: set[str],
    path: str = "",
) -> descriptor_pb2.DescriptorProto:
    """Recursively build a DescriptorProto from a BQ schema list.

    Side effect: populates ``timestamp_paths`` with dotted paths of fields
    whose BQ type is TIMESTAMP. The value mapper consults this set to know
    which int64 fields need datetime → microseconds conversion (proto
    inspection alone can't distinguish "INT64 micros-since-epoch" from
    "regular INT64").

    Field numbers are assigned sequentially per-message (1, 2, 3, …). The
    Storage Write API matches by name, not number, so the specific values
    don't matter as long as they're unique within their containing
    message. Sequential is simpler than maintaining a stable constant
    table; refactor risk is bounded by the schema-parity test.
    """
    msg = descriptor_pb2.DescriptorProto()
    msg.name = name
    self_fqn = f"{parent_fqn}.{name}"
    field_number = 1
    for col in schema:
        field_path = f"{path}.{col['name']}" if path else col["name"]
        f = msg.field.add()
        f.name = col["name"]
        f.number = field_number
        field_number += 1
        f.label = _BQ_MODE_TO_LABEL[col["mode"]]  # type: ignore[assignment]
        if col["type"] == "RECORD":
            nested_name = _to_message_name(col["name"])
            nested = _build_descriptor(
                col["fields"],
                name=nested_name,
                parent_fqn=self_fqn,
                timestamp_paths=timestamp_paths,
                path=field_path,
            )
            msg.nested_type.add().CopyFrom(nested)
            f.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
            f.type_name = f".{self_fqn}.{nested_name}"
        else:
            if col["type"] == "TIMESTAMP":
                timestamp_paths.add(field_path)
            f.type = _BQ_TO_PROTO_SCALAR[col["type"]]  # type: ignore[assignment]
    return msg


def _bq_schema_path() -> Path:
    """Locate ``schemas/bigquery/activities_full.json`` from this module.

    The schema lives outside the package (in the repo's top-level
    ``schemas/`` directory). At build time the Docker context copies it
    in, so the relative path resolves both locally and inside the
    container. Walk up from this file to find the schemas dir.
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "schemas" / "bigquery" / "activities_full.json"
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "Could not locate schemas/bigquery/activities_full.json relative "
        f"to {here}. Check Docker build context includes schemas/."
    )


def _build_message_class() -> tuple[type[Any], frozenset[str]]:
    """Build the dynamic message class for the activities table.

    Returns ``(message class, frozenset of TIMESTAMP field paths)``. The
    timestamp set is frozen so the value mapper can't accidentally
    mutate it.

    Uses a dedicated descriptor pool to avoid collisions with any other
    dynamically-built proto messages in the process (the spike wrapper
    has its own pool too — they don't conflict).
    """
    schema_doc = json.loads(_bq_schema_path().read_text())
    timestamp_paths: set[str] = set()

    file_proto = descriptor_pb2.FileDescriptorProto()
    file_proto.name = "stravapipe/activity_full.proto"
    file_proto.package = "stravapipe.activity_full"
    file_proto.syntax = "proto2"
    top = _build_descriptor(
        schema_doc["schema"],
        name="Activity",
        parent_fqn="stravapipe.activity_full",
        timestamp_paths=timestamp_paths,
    )
    file_proto.message_type.add().CopyFrom(top)

    pool = descriptor_pool.DescriptorPool()
    pool.Add(file_proto)
    descriptor = pool.FindMessageTypeByName("stravapipe.activity_full.Activity")
    return message_factory.GetMessageClass(descriptor), frozenset(timestamp_paths)


# Module-level: build once per process. The resulting class + timestamp
# set are immutable and deterministic from the schema file.
_MESSAGE_CLASS, _TIMESTAMP_PATHS = _build_message_class()


# ---------------------------------------------------------------------------
# Value mapping (Pydantic → proto)
# ---------------------------------------------------------------------------


def _iso_to_micros(value: str) -> int:
    """Parse an ISO-8601 string into microseconds since Unix epoch.

    Handles both forms Pydantic emits via ``model_dump(mode='json')``:
      - With timezone (``2018-02-16T14:52:54Z`` or ``…+00:00``)
      - Naive (``2018-02-16T14:52:54``) — treated as UTC for the
        conversion.

    The "treat naive as UTC" rule matches what BQ does internally: BQ's
    TIMESTAMP type stores microseconds since Unix epoch in UTC. When you
    insert a naive string via the legacy ``insertAll`` API, BQ assumes
    UTC. Doing the same here keeps the wire-level value consistent with
    historical rows.

    Note on ``start_date_local``: per ``CLAUDE.md`` "start_date_local is
    athlete local time — never convert to UTC." That guidance is about
    *query-time* interpretation: the stored micros represent the
    wall-clock value the athlete saw, with the timezone information
    discarded. This function doesn't violate that — for a naive input
    (or a Z-tagged input that's actually local-with-fake-Z, which is
    what Strava sends), the resulting micros encode the wall-clock
    numbers as if they were UTC.
    """
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp() * 1_000_000)


def _coerce_to_proto_type(value: Any, proto_type: int) -> Any:
    """Coerce a Python value to the proto field's declared scalar type.

    The legacy ``insertAll`` API silently coerces values that don't
    match the BQ column type (notably ``int → STRING`` for
    ``workout_type``, where Pydantic declares ``int`` but the BQ schema
    declares ``STRING``). The Storage Write API is strict; without
    coercion, we'd raise ``TypeError: bad argument type for built-in
    operation`` on the first such field.

    This is also where future Pydantic↔BQ drift gets papered over —
    pair this with the schema-parity test, which surfaces drift as a
    test failure rather than a prod incident.
    """
    if proto_type == FieldDescriptor.TYPE_STRING:
        return str(value)
    if proto_type == FieldDescriptor.TYPE_INT64:
        return int(value)
    if proto_type == FieldDescriptor.TYPE_DOUBLE:
        return float(value)
    if proto_type == FieldDescriptor.TYPE_BOOL:
        return bool(value)
    return value


def _populate_message(
    msg: Any,
    raw: dict[str, Any],
    *,
    timestamp_paths: frozenset[str],
    path: str = "",
) -> None:
    """Recursively populate a proto message from a JSON-shaped dict.

    ``raw`` is the output of ``activity.model_dump(mode='json')`` (or a
    sub-dict for nested RECORDs). Pydantic's mode='json' dump already
    converts ``datetime`` fields to ISO strings and runs validators
    like ``PhotosSummaryPrimary.transform_to_json_str`` (which encodes
    the photo URLs dict as a JSON string), so by the time we're here
    every leaf value is JSON-safe.

    Critical: NULLABLE fields with ``None`` values must be left
    *unset* on the proto, not set to a falsy value. proto2 distinguishes
    set-from-unset; setting ``int_field = 0`` sends the wire bytes for 0
    and BQ stores NOT NULL. The ``if value is None: continue`` guard
    is what preserves NULL semantics.
    """
    descriptor = msg.DESCRIPTOR
    for field in descriptor.fields:
        field_path = f"{path}.{field.name}" if path else field.name
        value = raw.get(field.name)
        if value is None:
            continue

        if field.is_repeated:
            if field.type == FieldDescriptor.TYPE_MESSAGE:
                for item in value:
                    sub = getattr(msg, field.name).add()
                    _populate_message(
                        sub,
                        item,
                        timestamp_paths=timestamp_paths,
                        path=field_path,
                    )
            else:
                # REPEATED scalar (e.g. start_latlng list[float],
                # available_zones list[str]). Coerce each item; the BQ
                # schema doesn't have any REPEATED TIMESTAMP columns,
                # so we don't handle that case.
                target = getattr(msg, field.name)
                target.extend(_coerce_to_proto_type(v, field.type) for v in value)
        elif field.type == FieldDescriptor.TYPE_MESSAGE:
            _populate_message(
                getattr(msg, field.name),
                value,
                timestamp_paths=timestamp_paths,
                path=field_path,
            )
        elif field_path in timestamp_paths:
            setattr(msg, field.name, _iso_to_micros(value))
        else:
            setattr(msg, field.name, _coerce_to_proto_type(value, field.type))


# ---------------------------------------------------------------------------
# Production wrapper class
# ---------------------------------------------------------------------------


class BigQueryStorageWriterV2:
    """Writes activities to BigQuery via Storage Write API default stream.

    Production wrapper covering the full ``activities_full.json`` schema.
    Same call shape as the spike's ``BigQueryStorageWriter`` so the
    cutover in ``bq_inserter_app.py`` is mechanical (swap the class,
    same ``write_activity(activity)`` interface).

    Per-call AppendRowsStream: each ``write_activity`` opens, sends, and
    closes its own stream. Reuse-the-stream optimization deferred until
    soak data shows it's needed.
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
        """Map a Pydantic activity onto the proto message and serialize."""
        msg = _MESSAGE_CLASS()
        _populate_message(
            msg,
            activity.model_dump(mode="json"),
            timestamp_paths=_TIMESTAMP_PATHS,
        )
        return bytes(msg.SerializeToString())

    def write_activity(self, activity: DetailedStravaActivity) -> None:
        """Write a single activity to the destination table.

        Raises on any underlying gRPC or schema error. Caller wraps in a
        try/except per its own retry/error policy — for the bq-inserter
        path, the existing ``handle_webhook_cloudevent`` translates
        exceptions to 5xx so Pub/Sub redelivers.
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
            future.result()  # type: ignore[no-untyped-call]
        finally:
            append_stream.close()


# ---------------------------------------------------------------------------
# Schema-parity helpers (used by tests; exported so admin/diagnose
# utilities can reuse if needed)
# ---------------------------------------------------------------------------


def iter_bq_schema_paths(
    schema: Iterable[dict[str, Any]],
    *,
    path: str = "",
) -> Iterable[tuple[str, dict[str, Any]]]:
    """Yield ``(dotted_path, field_dict)`` for every leaf in a BQ schema.

    Used by the schema-parity test to compare the BQ schema against the
    Pydantic model. Recurses through RECORD fields.
    """
    for col in schema:
        field_path = f"{path}.{col['name']}" if path else col["name"]
        if col["type"] == "RECORD":
            yield from iter_bq_schema_paths(col["fields"], path=field_path)
        else:
            yield field_path, col
