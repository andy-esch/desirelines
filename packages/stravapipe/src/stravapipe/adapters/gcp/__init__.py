"""GCP adapters."""

from opentelemetry.metrics import Histogram
from opentelemetry.trace import Tracer

from stravapipe.adapters.gcp._bigquery import ActivitiesWriter
from stravapipe.adapters.gcp._bigquery_storage import BigQueryStorageWriter
from stravapipe.adapters.gcp._clients import BigQueryClientWrapper, MergeResult


def make_bigquery_client_wrapper(*, project_id: str) -> BigQueryClientWrapper:
    """Create a BigQuery client wrapper for the given project."""
    return BigQueryClientWrapper(project_id=project_id)


def make_write_activities(
    *,
    project_id: str,
    bq_dataset: str,
    tracer: Tracer | None = None,
    histogram: Histogram | None = None,
) -> ActivitiesWriter:
    """Create an ``ActivitiesWriter`` for the backfill job.

    Batch-only: ``write_activities_batch()`` plus ``close()``. Live writes
    reach BigQuery through the Pub/Sub CDC subscription, not this writer.

    Pass ``tracer`` from the Cloud Run service so write/merge/cleanup steps
    emit sub-spans. Pass ``histogram`` so the same steps record duration on
    the existing ``desirelines.io/bigquery/operation.duration`` histogram
    (with operation labels matching span names — see SLO/alerting tasks).
    Batch jobs that don't initialize OTel can leave both unset.
    """
    client = make_bigquery_client_wrapper(project_id=project_id)
    storage_writer = BigQueryStorageWriter(
        project_id=project_id,
        dataset_name=bq_dataset,
        table_name="activities_staging",
    )
    return ActivitiesWriter(
        client=client,
        storage_writer=storage_writer,
        dataset_name=bq_dataset,
        tracer=tracer,
        histogram=histogram,
    )


__all__ = [
    "ActivitiesWriter",
    "BigQueryClientWrapper",
    "BigQueryStorageWriter",
    "MergeResult",
    "make_bigquery_client_wrapper",
    "make_write_activities",
]
