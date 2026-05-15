"""BigQuery Storage Write API adapter for the activities staging table.

Owns the mapping from ``DetailedStravaActivity`` /
``SummaryStravaActivity`` to the protobuf message generated from
``schemas/bigquery/activities_full.json``, and the two write entry
points (``write_activity`` for the webhook path, ``write_activities_batch``
for the backfill path) used by ``ActivitiesWriter``.

Key gotchas (read before changing anything here):

- **proto2 syntax, not proto3.** BigQuery Storage Write rejects
  descriptors carrying the ``[proto3_optional=true]`` annotation that
  proto3's ``optional`` keyword generates. The generated proto is
  ``syntax = "proto2"`` with every non-repeated field labeled
  ``optional``. See ``schemas/bigquery/generate_proto.py`` for the
  generator and ``schemas/proto/desirelines/bigquery/v1/bq_activities.proto``
  for the output. Per Google's
  [Storage Write API best practices](https://docs.cloud.google.com/bigquery/docs/write-api-best-practices).

- **TIMESTAMP as int64 micros-since-epoch.** The API does not accept
  the proto well-known ``Timestamp`` message for BQ TIMESTAMP columns.
  ``_TIMESTAMP_PATHS`` enumerates the affected dotted paths;
  ``_iso_to_micros`` does the conversion at write time.

- **One long-lived ``AppendRowsStream`` per writer.** Per Google's
  docs: "Don't use one connection for just a single write." The stream
  is lazy-opened on first send, reused, and re-opened on failure (see
  ``_send_serialized``). ``close()`` is wired into the Cloud Run
  lifespan / backfill teardown.

- **Pydantic ↔ BQ type drift handled by explicit coercion.** Storage
  Write is strict about field types; the legacy ``insertAll`` was lax.
  ``_coerce_to_proto_type`` papers over the known mismatches (notably
  ``workout_type``: ``int`` in Pydantic, ``STRING`` in BQ). The
  schema-parity test in ``test_bigquery_storage.py`` fails if a new
  drift sneaks in.

- **Failed stream opens surface as `Unknown` with no detail.** The
  underlying gRPC error gets wrapped into ``api_core.exceptions.Unknown``
  with the unhelpful message "There was a problem opening the stream.
  Try turning on DEBUG level logs to see the error." To see the real
  cause, set ``GRPC_VERBOSITY=DEBUG`` on the Cloud Run service — the
  gRPC C-core logs to stderr, which Cloud Logging captures at
  ``DEFAULT`` severity.
"""

from collections.abc import Sequence
from contextlib import suppress
from datetime import UTC, datetime
import threading
from typing import Any

from google.cloud.bigquery_storage_v1 import BigQueryWriteClient, types, writer
from google.cloud.bigquery_storage_v1.exceptions import StreamClosedError
from google.protobuf import descriptor_pb2
from google.protobuf.descriptor import FieldDescriptor

from stravapipe.domain import DetailedStravaActivity, SummaryStravaActivity
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
    tz-aware (``…Z`` or ``…+00:00``) and naive. Naive inputs are treated
    as UTC, matching BQ's internal TIMESTAMP representation (micros
    since epoch, UTC).

    ``start_date_local`` is athlete local time, not UTC. Strava sends
    it either Z-suffixed with the wall-clock numbers (not actually
    UTC) or naive. Either way, this function encodes the wall-clock
    numbers *as if* they were UTC — the timezone is discarded and the
    stored micros represent the value the athlete saw on their watch.
    Consumers must interpret it as local time at query time.
    """
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp() * 1_000_000)


def _coerce_to_proto_type(value: Any, proto_type: int) -> Any:
    """Coerce a Python value to the proto field's declared scalar type.

    Storage Write is strict about field types and raises
    ``TypeError: bad argument type for built-in operation`` on the
    first mismatched field. The motivating case is ``workout_type``,
    which Pydantic declares ``int`` but the BQ schema declares
    ``STRING``; future Pydantic↔BQ drift lands here too. The
    schema-parity test in ``test_bigquery_storage.py`` is the safety
    net that surfaces new drift as a test failure rather than a prod
    incident.
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
    sub-dict for nested RECORDs). Pydantic's mode='json' dump converts
    ``datetime`` fields to ISO strings and runs validators (e.g.
    ``PhotosSummaryPrimary.transform_to_json_str`` encodes the photo
    URLs dict as a JSON string), so every leaf value is JSON-safe by
    the time we're here.

    NULL semantics: fields with ``None`` values must be left *unset*
    on the proto. Proto2 ``optional`` fields distinguish set-from-unset;
    setting an int field to 0 explicitly sends 0 on the wire and BQ
    stores NOT NULL. The ``if value is None: continue`` guard is what
    preserves NULL.
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

    Owns one long-lived ``AppendRowsStream`` per writer instance, reused
    across writes. The stream is lazy-opened on first send and re-opened
    after any send failure (single in-process recovery; Pub/Sub
    redelivery is the higher-level retry). ``close()`` shuts down the
    stream cleanly and should be called from the Cloud Run service
    lifespan / backfill job teardown.
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
        # Lazy-opened, lock-protected, single AppendRowsStream slot.
        # `_send_serialized` is the only writer; `close()` resets to None.
        self._stream: writer.AppendRowsStream | None = None
        self._stream_lock = threading.Lock()

    def _default_stream(self) -> str:
        # Canonical resource name per `WriteStream` proto pattern:
        # `projects/{p}/datasets/{d}/tables/{t}/streams/_default`. Built via
        # the lib's own helper so the format stays in sync with the proto
        # definition if Google ever changes it.
        return self._client.write_stream_path(
            self._project_id, self._dataset_name, self._table_name, "_default"
        )

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

    @staticmethod
    def _dump_for_bq(
        activity: DetailedStravaActivity | SummaryStravaActivity,
    ) -> dict[str, Any]:
        """JSON-shaped dict for proto population.

        ``SummaryStravaActivity.to_bq_dict()`` excludes fields not present
        in the BQ schema (e.g. ``location_city``); ``DetailedStravaActivity``
        already matches the schema 1:1 so its plain ``model_dump`` is
        sufficient.
        """
        if isinstance(activity, SummaryStravaActivity):
            return activity.to_bq_dict()
        return activity.model_dump(mode="json")

    def _serialize(self, raw: dict[str, Any]) -> bytes:
        """Map a JSON-shaped dict onto the proto message and serialize."""
        msg = bq_activities_pb2.Activity()
        _populate_message(msg, raw)
        return bytes(msg.SerializeToString())

    def _get_or_open_stream(self) -> writer.AppendRowsStream:
        """Return the active stream, lazy-opening one if needed.

        Must be called with ``self._stream_lock`` held.
        """
        if self._stream is not None and self._stream.is_active:
            return self._stream
        # Stream slot is empty or stale. Drop first (no-op if None;
        # closes and clears if stale) so we don't leak the underlying
        # gRPC channel on the rare server-side-close-between-writes
        # path. The new stream's first send() triggers the open().
        self._drop_stream()
        self._stream = writer.AppendRowsStream(self._client, self._request_template)
        return self._stream

    def _drop_stream(self) -> None:
        """Close and clear the stream slot.

        Must be called with ``self._stream_lock`` held. Suppresses
        ``StreamClosedError`` because the library's ``_open()`` may have
        already invoked its internal ``self.close(reason=...)`` if open
        failed, leaving the stream in a closed state.
        """
        if self._stream is None:
            return
        with suppress(StreamClosedError):
            self._stream.close()
        self._stream = None

    def _send_serialized(self, serialized_rows: list[bytes]) -> None:
        """Send one AppendRowsRequest containing the given pre-serialized rows.

        Uses the long-lived stream when available. On any send failure
        the stream is dropped so the next call opens a fresh one;
        Pub/Sub redelivery handles the retry of the failed write.
        """
        proto_rows = types.ProtoRows()
        proto_rows.serialized_rows.extend(serialized_rows)

        proto_data = types.AppendRowsRequest.ProtoData()
        proto_data.rows = proto_rows

        request = types.AppendRowsRequest()
        request.proto_rows = proto_data

        with self._stream_lock:
            try:
                stream = self._get_or_open_stream()
                future = stream.send(request)
                future.result()  # type: ignore[no-untyped-call]
            except Exception:
                self._drop_stream()
                raise

    def close(self) -> None:
        """Close the underlying stream. Idempotent and safe to call once
        from the Cloud Run service lifespan or batch-job teardown."""
        with self._stream_lock:
            self._drop_stream()

    def write_activity(self, activity: DetailedStravaActivity) -> None:
        """Write a single activity to the destination table.

        Raises on any underlying gRPC or schema error. Caller wraps in a
        try/except per its own retry/error policy — for the bq-inserter
        path, the existing ``handle_webhook_cloudevent`` translates
        exceptions to 5xx so Pub/Sub redelivers.
        """
        self._send_serialized([self._serialize(self._dump_for_bq(activity))])

    def write_activities_batch(
        self,
        activities: Sequence[DetailedStravaActivity | SummaryStravaActivity],
    ) -> None:
        """Write multiple activities in a single AppendRowsRequest.

        Sized for backfill, which already chunks at the application
        layer (``BackfillService._batch_size``, default 100). Storage
        Write API caps requests at 10 MB total bytes; with default
        backfill chunking the cap is comfortably out of reach.

        Empty list is a no-op (no stream opened) to keep the caller
        contract symmetric with the legacy ``insert_rows_json`` path.
        """
        if not activities:
            return
        serialized = [self._serialize(self._dump_for_bq(a)) for a in activities]
        self._send_serialized(serialized)
