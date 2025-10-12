"""GCP adapters."""

from stravapipe.adapters.gcp._bigquery import WriteActivitiesRepo
from stravapipe.adapters.gcp._clients import (
    BigQueryClientWrapper,
    CloudStorageClientWrapper,
)
from stravapipe.adapters.gcp._storage import (
    DistancesRepo,
    PacingsRepo,
    SummariesRepo,
)
from stravapipe.config import AggregatorConfig, BQInserterConfig
from stravapipe.ports.out.read import ReadSummaries
from stravapipe.ports.out.write import WriteSummary


def make_bigquery_client_wrapper(config: BQInserterConfig) -> BigQueryClientWrapper:
    """Create a BigQuery client wrapper with the given config."""
    return BigQueryClientWrapper(project_id=config.project_id)


def make_write_activities(config: BQInserterConfig) -> WriteActivitiesRepo:
    """Create a WriteActivitiesRepo with the given config."""
    client = make_bigquery_client_wrapper(config)
    return WriteActivitiesRepo(
        client=client,
        dataset_name=config.bq_dataset,
    )


def _make_summaries_repo(config: AggregatorConfig) -> SummariesRepo:
    """Create a SummariesRepo (used for both read and write)."""
    client = CloudStorageClientWrapper(
        project_id=config.gcp_project_id,
        bucket_name=config.gcp_bucket_name,
    )
    return SummariesRepo(client=client)


def make_read_summaries(config: AggregatorConfig) -> ReadSummaries:
    """Create a ReadSummaries adapter for reading summary JSON from Cloud Storage."""
    return _make_summaries_repo(config)


def make_write_summary(config: AggregatorConfig) -> WriteSummary:
    """Create a WriteSummary adapter for writing summary JSON to Cloud Storage."""
    return _make_summaries_repo(config)


def make_write_pacings(config: AggregatorConfig) -> PacingsRepo:
    """Create a PacingsRepo for writing pacing timeseries."""
    client = CloudStorageClientWrapper(
        project_id=config.gcp_project_id,
        bucket_name=config.gcp_bucket_name,
    )
    return PacingsRepo(client=client)


def make_write_distances(config: AggregatorConfig) -> DistancesRepo:
    """Create a DistancesRepo for writing distance timeseries."""
    client = CloudStorageClientWrapper(
        project_id=config.gcp_project_id,
        bucket_name=config.gcp_bucket_name,
    )
    return DistancesRepo(client=client)


__all__ = [
    "BigQueryClientWrapper",
    "CloudStorageClientWrapper",
    "DistancesRepo",
    "PacingsRepo",
    "SummariesRepo",
    "WriteActivitiesRepo",
    "make_bigquery_client_wrapper",
    "make_read_summaries",
    "make_write_activities",
    "make_write_distances",
    "make_write_pacings",
    "make_write_summary",
]
