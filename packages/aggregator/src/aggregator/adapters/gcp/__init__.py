from aggregator.adapters.gcp._clients import (
    CloudStorageClientWrapper,
)
from aggregator.adapters.gcp._repositories import (
    DistancesRepo,
    PacingsRepo,
    SummariesRepo,
)
from aggregator.config import AggregatorConfig
from aggregator.ports.out.read import ReadSummaries
from aggregator.ports.out.write import WriteDistances, WritePacings, WriteSummary

__all__ = [
    "CloudStorageClientWrapper",
    "make_google_cloud_client_wrapper",
    "make_read_summaries",
    "make_write_distances",
    "make_write_pacings",
    "make_write_summary",
]


def make_google_cloud_client_wrapper(
    config: AggregatorConfig,
) -> CloudStorageClientWrapper:
    return CloudStorageClientWrapper(config)


def _make_summaries_repo(config: AggregatorConfig) -> SummariesRepo:
    return SummariesRepo(make_google_cloud_client_wrapper(config))


def make_read_summaries(config: AggregatorConfig) -> ReadSummaries:
    return _make_summaries_repo(config)


def make_write_summary(config: AggregatorConfig) -> WriteSummary:
    return _make_summaries_repo(config)


def make_write_distances(config: AggregatorConfig) -> WriteDistances:
    return DistancesRepo(make_google_cloud_client_wrapper(config))


def make_write_pacings(config: AggregatorConfig) -> WritePacings:
    return PacingsRepo(make_google_cloud_client_wrapper(config))
