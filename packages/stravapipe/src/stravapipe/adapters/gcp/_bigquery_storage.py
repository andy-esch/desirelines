"""BigQuery Storage Write API adapter — production wrapper (full schema).

Companion to ``_bigquery_storage.py`` (the spike's 7-field subset wrapper).
This module ships the full mapping for ``schemas/bigquery/activities_full.json``
and is the wrapper Stage 1 will swap into ``_write_to_staging`` once the
spike's soak returns GO.

Until cutover, this module is **not imported by any production path**.
It coexists with the spike wrapper so reviewers can compare them and
the cutover is a one-line edit in ``bq_inserter_app.py``.

Architecture:

- **Static proto, generated from BQ schema.** ``schemas/bigquery/activities_full.json``
  is the source of truth; ``schemas/bigquery/generate_proto.py`` converts it
  to ``schemas/proto/desirelines/bigquery/v1/bq_activities.proto``; Pants's
  protobuf codegen produces ``stravapipe.types.generated.bq_activities_pb2``.
  This module imports the generated ``Activity`` class directly — no runtime
  descriptor building, no JSON file reading.
- **Strict type coercion at write time.** The legacy ``insertAll`` API
  silently coerces (e.g. ``int → STRING`` for ``workout_type``); Storage
  Write is strict. ``_coerce_to_proto_type`` replicates the legacy
  coercion explicitly so we don't crash on the first activity with a
  type-mismatched field.
- **TIMESTAMP via int64 microseconds.** BQ Storage Write expects raw
  micros-since-epoch, *not* the proto well-known ``Timestamp`` message.
  ``_iso_to_micros`` handles tz-aware ISO strings (with Z or offset) and
  naive ones (treated as UTC for conversion — matches insertAll's
  behavior and BQ's internal storage convention).
- **Default stream, per-call AppendRowsStream.** Same shape as the
  spike. Reuse-the-stream optimization is deferred to a future task if
  latency surprises us.

The set of fields encoded as TIMESTAMP is hard-coded below
(``_TIMESTAMP_PATHS``). The schema-parity test in
``test_bigquery_storage.py`` verifies this set matches the
``TIMESTAMP`` columns in the BQ JSON schema; if it drifts, CI fails.
"""

from datetime import UTC, datetime
from typing import Any

from google.cloud.bigquery_storage_v1 import BigQueryWriteClient, types, writer
from google.protobuf import descriptor_pb2
from google.protobuf.descriptor import FieldDescriptor

from stravapipe.domain import DetailedStravaActivity
from stravapipe.types.generated import bq_activities_pb2

# ---------------------------------------------------------------------------
# TIMESTAMP path tracking
# ---------------------------------------------------------------------------

# Dotted paths of fields that the BQ schema declares as TIMESTAMP. The
# generated proto encodes them as int64; this set tells the value mapper
# which int64s need datetime → microseconds-since-epoch conversion at
# write time.
#
# Hand-maintained but verified by the schema-parity test against
# `schemas/bigquery/activities_full.json`. If you add a new TIMESTAMP
# column to the BQ schema, the test fails until you add the path here.
_TIMESTAMP_PATHS: frozenset[str] = frozenset(
    {
        "start_date",
        "start_date_local",
        "segment_efforts.start_date",
        "segment_efforts.start_date_local",
        "laps.start_date",
        "laps.start_date_local",
        "best_efforts.start_date",
        "best_efforts.start_date_local",
    }
)


# ---------------------------------------------------------------------------
# Value mapping (Pydantic → proto)
# ---------------------------------------------------------------------------


def _iso_to_micros(value: str) -> int:
    """Parse an ISO-8601 string into microseconds since Unix epoch.

    Handles both forms Pydantic emits via ``model_dump(mode='json')``:
      - With timezone (``2018-02-16T14:52:54Z`` or ``…+00:00``).
        Python 3.11+ ``datetime.fromisoformat`` accepts both natively.
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
    timestamp_paths: frozenset[str] = _TIMESTAMP_PATHS,
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
    *unset* on the proto, not set to a falsy value. proto3 distinguishes
    set-from-unset for ``optional`` fields; setting an int field
    explicitly to 0 sends the wire bytes for 0 and BQ stores NOT NULL.
    The ``if value is None: continue`` guard is what preserves NULL
    semantics.
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


class BigQueryStorageWriter:
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
        bq_activities_pb2.Activity.DESCRIPTOR.CopyToProto(descriptor)
        proto_schema.proto_descriptor = descriptor

        proto_data = types.AppendRowsRequest.ProtoData()
        proto_data.writer_schema = proto_schema
        request.proto_rows = proto_data
        return request

    def _serialize_activity(self, activity: DetailedStravaActivity) -> bytes:
        """Map a Pydantic activity onto the proto message and serialize."""
        msg = bq_activities_pb2.Activity()
        _populate_message(msg, activity.model_dump(mode="json"))
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
