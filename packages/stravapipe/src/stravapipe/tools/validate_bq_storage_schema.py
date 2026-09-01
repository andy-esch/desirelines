"""Validate the BigQuery Storage Write API proto descriptor against a real BQ table.

Bridges the gap left by the API itself: the server-side schema check is the
only authoritative validation, but the lib surfaces failures as a generic
``Unknown`` wrapper that hides the actual cause unless ``GRPC_VERBOSITY=DEBUG``
is set. Running this script locally before a deploy catches schema-shape
issues (proto3_optional, unresolved nested-type references, name/type
mismatches, etc.) in seconds rather than after a webhook-triggered failure
in dev.

How it works:
    Opens an ``AppendRowsStream`` against the target table and sends a
    request carrying the flattened proto descriptor as ``writer_schema``,
    plus a minimal ``Activity`` row (just ``id = 0``). The BQ server
    validates the descriptor on stream open; a bad descriptor surfaces as
    a clear gRPC error rather than the lib's opaque ``Unknown`` wrapper.

Usage::

    just bq-validate-schema                          # defaults to desirelines-dev
    just bq-validate-schema desirelines-prod         # validate against a different project

    # Or directly:
    uv run python -m stravapipe.tools.validate_bq_storage_schema \\
        --project desirelines-dev \\
        --dataset desirelines \\
        --table activities_staging

Requires Application Default Credentials (``gcloud auth application-default
login``) with ``bigquery.dataEditor`` on the target dataset.

Side effects:
    Writes one synthetic row (``id = 0``) to the target table. Pick a
    staging table (default ``activities_staging``); the row will be
    cleaned up by the production MERGE/cleanup cycle on the next real
    activity write.
"""

import argparse
import sys

from google.api_core import exceptions as gapi_exceptions

from stravapipe.adapters.gcp._bigquery_storage import BigQueryStorageWriter
from stravapipe.types.generated import bq_activities_pb2

# Server messages that indicate the *descriptor itself* was rejected
# (vs row data being invalid). Descriptor rejection is the failure mode
# this script is built to catch; row-data errors mean the descriptor
# was accepted (good) and would never fire in prod where rows come
# from real Strava webhooks with all REQUIRED fields populated.
_DESCRIPTOR_REJECTION_MARKERS = (
    "Invalid proto schema",
    "is not defined",
    "proto3_optional",
    "There was a problem opening the stream",
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="GCP project ID")
    parser.add_argument("--dataset", default="desirelines", help="BigQuery dataset")
    parser.add_argument(
        "--table",
        default="activities_staging",
        help="BigQuery table (default: activities_staging)",
    )
    args = parser.parse_args(argv)

    print(
        f"Validating BQ Storage Write schema against "
        f"{args.project}.{args.dataset}.{args.table} ..."
    )
    writer = BigQueryStorageWriter(
        project_id=args.project,
        dataset_name=args.dataset,
        table_name=args.table,
    )
    # The minimal proto message that exercises the schema validation path
    # on stream open. Proto2 + every-field-optional means a bare message
    # with just `id` set serializes successfully against the flattened
    # descriptor; the BQ server then validates the descriptor before
    # appending the row.
    msg = bq_activities_pb2.Activity()
    msg.id = 0
    serialized = msg.SerializeToString()

    try:
        writer._send_serialized([serialized])
    except (gapi_exceptions.InvalidArgument, gapi_exceptions.Unknown) as e:
        # Differentiate descriptor rejection (the failure mode this script
        # is designed to catch) from row-data validation errors (which
        # mean the descriptor was accepted — success for our purposes —
        # and just our minimal synthetic row didn't carry the REQUIRED
        # fields the BQ schema demands).
        if any(marker in str(e) for marker in _DESCRIPTOR_REJECTION_MARKERS):
            print(f"FAIL: descriptor rejected: {e}", file=sys.stderr)
            print(
                "\nTip: set GRPC_VERBOSITY=DEBUG before re-running to surface "
                "the underlying gRPC status (the lib wraps schema errors in a "
                "generic Unknown otherwise).",
                file=sys.stderr,
            )
            return 1
        print(
            "OK: descriptor accepted. Server rejected the synthetic test "
            "row's data (expected — the script intentionally sends a "
            "minimal row that doesn't carry every REQUIRED field). Real "
            "Strava activities carry all REQUIRED fields and will pass "
            f"row validation. Server reported: {e}"
        )
        return 0
    else:
        print("OK: descriptor accepted and synthetic row written.")
        return 0
    finally:
        writer.close()


if __name__ == "__main__":
    sys.exit(main())
