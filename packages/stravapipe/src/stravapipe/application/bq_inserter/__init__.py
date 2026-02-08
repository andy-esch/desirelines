"""BQ inserter services for webhook processing.

Activity data is now provided inline by the dispatcher's enriched events.
The SyncService (which fetched from Strava API) is no longer used.
"""

from google.cloud import bigquery

from stravapipe.application.bq_inserter.delete_service import DeleteActivityService
from stravapipe.config import BQInserterConfig, load_bq_inserter_config


def make_delete_service(
    config: BQInserterConfig | None = None,
) -> DeleteActivityService:
    """Create a configured DeleteActivityService instance.

    Factory function that wires together all dependencies needed for the
    delete service.

    Args:
        config: Application configuration. If None, loads from environment.

    Returns:
        DeleteActivityService: Fully configured delete service instance.

    Raises:
        ConfigurationError: If required configuration is missing.
    """
    if config is None:
        config = load_bq_inserter_config()

    bq_client = bigquery.Client(project=config.gcp_project_id)

    return DeleteActivityService(
        bq_client=bq_client,
        project_id=config.gcp_project_id,
        dataset_id=config.gcp_bigquery_dataset,
    )


__all__ = [
    "DeleteActivityService",
    "make_delete_service",
]
