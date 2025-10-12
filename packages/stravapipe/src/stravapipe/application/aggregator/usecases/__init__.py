"""Aggregator use cases for webhook processing."""

from stravapipe.adapters.gcp import make_read_summaries
from stravapipe.adapters.strava import (
    make_read_minimal_activities,
    make_read_strava_token,
)
from stravapipe.application.aggregator.services import (
    make_export_service,
    make_pacing_service,
)
from stravapipe.application.aggregator.usecases.update_summary import (
    UpdateSummaryUseCase,
)
from stravapipe.config import AggregatorConfig, load_aggregator_config


def make_update_summary_use_case(
    config: AggregatorConfig | None = None,
) -> UpdateSummaryUseCase:
    """Create a configured UpdateSummaryUseCase instance.

    Factory function that wires together all dependencies needed for the
    update summary use case.

    Args:
        config: Application configuration. If None, loads from environment.

    Returns:
        UpdateSummaryUseCase: Fully configured use case instance.

    Raises:
        ConfigurationError: If required configuration is missing.
    """
    if config is None:
        config = load_aggregator_config()

    return UpdateSummaryUseCase(
        read_activities=lambda tokens: make_read_minimal_activities(tokens),
        read_summaries=lambda: make_read_summaries(config),
        read_strava_token=lambda: make_read_strava_token(config.tokens),
        pacing_service=make_pacing_service,
        export_service=lambda: make_export_service(config),
    )


__all__ = [
    "UpdateSummaryUseCase",
    "make_update_summary_use_case",
]
