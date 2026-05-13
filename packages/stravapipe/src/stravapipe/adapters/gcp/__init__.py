"""GCP adapters."""

from opentelemetry.metrics import Histogram
from opentelemetry.trace import Tracer

from stravapipe.adapters.gcp._bigquery import ActivitiesReader, ActivitiesWriter
from stravapipe.adapters.gcp._bigquery_storage import BigQueryStorageWriter
from stravapipe.adapters.gcp._clients import BigQueryClientWrapper, MergeResult
from stravapipe.config import BQInserterConfig
from stravapipe.ports.out.read import ReadActivitiesMetadata
from stravapipe.ports.out.write import WriteActivities


def make_bigquery_client_wrapper(config: BQInserterConfig) -> BigQueryClientWrapper:
    """Create a BigQuery client wrapper with the given config."""
    return BigQueryClientWrapper(project_id=config.project_id)


def make_write_activities(
    config: BQInserterConfig,
    *,
    tracer: Tracer | None = None,
    histogram: Histogram | None = None,
) -> WriteActivities:
    """Create an ActivitiesWriter (WriteActivities port) with the given config.

    The single-activity write path uses the BigQuery Storage Write API
    (``BigQueryStorageWriter``) targeting the staging table. The batch
    path inside ``ActivitiesWriter`` still uses the legacy
    ``insert_rows_json`` API — Stage 2 migrates that.

    Pass ``tracer`` from the Cloud Run service so write/merge/cleanup steps
    emit sub-spans. Pass ``histogram`` so the same steps record duration on
    the existing ``desirelines.io/bigquery/operation.duration`` histogram
    (with operation labels matching span names — see SLO/alerting tasks).
    Batch jobs that don't initialize OTel can leave both unset.
    """
    client = make_bigquery_client_wrapper(config)
    storage_writer = BigQueryStorageWriter(
        project_id=config.project_id,
        dataset_name=config.bq_dataset,
        table_name="activities_staging",
    )
    return ActivitiesWriter(
        client=client,
        storage_writer=storage_writer,
        dataset_name=config.bq_dataset,
        tracer=tracer,
        histogram=histogram,
    )


def make_read_activities(config: BQInserterConfig) -> ReadActivitiesMetadata:
    """Create an ActivitiesReader (ReadActivitiesMetadata port) with the given config."""
    client = make_bigquery_client_wrapper(config)
    return ActivitiesReader(
        client=client,
        dataset_name=config.bq_dataset,
    )


__all__ = [
    "ActivitiesReader",
    "ActivitiesWriter",
    "BigQueryClientWrapper",
    "BigQueryStorageWriter",
    "MergeResult",
    "make_bigquery_client_wrapper",
    "make_read_activities",
    "make_write_activities",
]
