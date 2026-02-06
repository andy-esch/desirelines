"""GCP adapters."""

from stravapipe.adapters.gcp._bigquery import ActivitiesReader, ActivitiesWriter
from stravapipe.adapters.gcp._clients import BigQueryClientWrapper, MergeResult
from stravapipe.config import BQInserterConfig
from stravapipe.ports.out.read import ReadActivitiesMetadata
from stravapipe.ports.out.write import WriteActivities


def make_bigquery_client_wrapper(config: BQInserterConfig) -> BigQueryClientWrapper:
    """Create a BigQuery client wrapper with the given config."""
    return BigQueryClientWrapper(project_id=config.project_id)


def make_write_activities(config: BQInserterConfig) -> WriteActivities:
    """Create an ActivitiesWriter (WriteActivities port) with the given config."""
    client = make_bigquery_client_wrapper(config)
    return ActivitiesWriter(
        client=client,
        dataset_name=config.bq_dataset,
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
    "MergeResult",
    "make_bigquery_client_wrapper",
    "make_read_activities",
    "make_write_activities",
]
