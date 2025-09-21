from stravabqsync.adapters.gcp import make_write_activities
from stravabqsync.adapters.strava import make_read_activities, make_read_strava_token
from stravabqsync.application.services._sync_service import SyncService
from stravabqsync.config import BQInserterConfig, load_bq_inserter_config


def make_sync_service(config: BQInserterConfig | None = None) -> SyncService:
    """Create a configured SyncService instance.

    Factory function that wires together all dependencies needed for the
    sync service. Uses LRU cache to ensure singleton behavior.

    Args:
        config: Application configuration. If None, loads from environment.

    Returns:
        SyncService: Fully configured sync service instance.

    Raises:
        StravaTokenError: If initial token refresh fails.
        ConfigurationError: If required configuration is missing.
    """
    if config is None:
        config = load_bq_inserter_config()

    return SyncService(
        read_strava_token=lambda: make_read_strava_token(config),
        read_activities=lambda tokens: make_read_activities(tokens, config),
        write_activities=lambda: make_write_activities(config),
    )
