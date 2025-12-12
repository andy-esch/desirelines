"""Configuration modules for stravapipe functions."""

from stravapipe.config.aggregator import AggregatorConfig, load_aggregator_config
from stravapipe.config.bq_inserter import BQInserterConfig, load_bq_inserter_config
from stravapipe.config.common import StravaApiConfig
from stravapipe.config.postgres_writer import (
    PostgresWriterConfig,
    load_postgres_writer_config,
)

__all__ = [
    "AggregatorConfig",
    "BQInserterConfig",
    "PostgresWriterConfig",
    "StravaApiConfig",
    "load_aggregator_config",
    "load_bq_inserter_config",
    "load_postgres_writer_config",
]
