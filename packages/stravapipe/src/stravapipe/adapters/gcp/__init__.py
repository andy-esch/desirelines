"""GCP adapters."""

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
) -> WriteActivities:
    """Create an ActivitiesWriter (WriteActivities port) with the given config.

    Pass ``tracer`` from the Cloud Run service so write/merge/cleanup steps
    emit sub-spans. Batch jobs that don't initialize OTel can leave it unset.
    """
    client = make_bigquery_client_wrapper(config)
    return ActivitiesWriter(
        client=client,
        dataset_name=config.bq_dataset,
        tracer=tracer,
    )


def make_read_activities(config: BQInserterConfig) -> ReadActivitiesMetadata:
    """Create an ActivitiesReader (ReadActivitiesMetadata port) with the given config."""
    client = make_bigquery_client_wrapper(config)
    return ActivitiesReader(
        client=client,
        dataset_name=config.bq_dataset,
    )


def make_storage_writer(config: BQInserterConfig) -> BigQueryStorageWriter | None:
    """Create the experimental Storage Write API writer (or None if disabled).

    Returns None when the feature flag is off so callers can branch on
    presence. The wrapper is spike-scoped — see _bigquery_storage.py for
    schema scope and the related task for context.
    """
    if not config.bq_swapi_experiment_enabled:
        return None
    return BigQueryStorageWriter(
        project_id=config.project_id,
        dataset_name=config.bq_dataset,
        table_name=config.bq_swapi_experiment_table,
    )


__all__ = [
    "ActivitiesReader",
    "ActivitiesWriter",
    "BigQueryClientWrapper",
    "BigQueryStorageWriter",
    "MergeResult",
    "make_bigquery_client_wrapper",
    "make_read_activities",
    "make_storage_writer",
    "make_write_activities",
]
