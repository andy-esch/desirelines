"""BQ inserter services for webhook processing.

Activity data is provided inline by the dispatcher's enriched events rather
than fetched from the Strava API.
"""

from opentelemetry.trace import Tracer

from stravapipe.adapters.gcp import BigQueryClientWrapper
from stravapipe.application.bq_inserter.delete_service import (
    BQActivityDeletionResult,
    DeleteActivityService,
)
from stravapipe.config import BQInserterConfig, load_bq_inserter_config


def make_delete_service(
    config: BQInserterConfig | None = None,
    *,
    tracer: Tracer | None = None,
) -> DeleteActivityService:
    """Create a configured DeleteActivityService instance.

    Factory function that wires together all dependencies needed for the
    delete service.

    Args:
        config: Application configuration. If None, loads from environment.
        tracer: Optional OTel tracer threaded into the service so the archive
            INSERT and activity DELETE DML jobs each emit their own sub-span.

    Returns:
        DeleteActivityService: Fully configured delete service instance.

    Raises:
        ConfigurationError: If required configuration is missing.
    """
    if config is None:
        config = load_bq_inserter_config()

    client = BigQueryClientWrapper(project_id=config.project_id)

    return DeleteActivityService(
        client=client,
        dataset_id=config.bq_dataset,
        tracer=tracer,
    )


__all__ = [
    "BQActivityDeletionResult",
    "DeleteActivityService",
    "make_delete_service",
]
