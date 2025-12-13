"""PostgreSQL sync services for webhook processing.

This module provides factory functions that wire together all dependencies
for the PostgreSQL writer service. Token refresh happens at the factory level,
not in the service - keeping the service focused on its core responsibility.
"""

from stravapipe.adapters.postgres import SqlAlchemyUnitOfWork
from stravapipe.adapters.postgres._unit_of_work import create_session_factory
from stravapipe.adapters.strava import (
    make_read_standard_activities,
    make_read_strava_token,
)
from stravapipe.application.postgres_sync.write_service import PostgresWriteService
from stravapipe.config import PostgresWriterConfig, load_postgres_writer_config


def make_postgres_write_service(
    config: PostgresWriterConfig | None = None,
) -> PostgresWriteService:
    """Create a configured PostgresWriteService instance.

    Factory function that wires together all dependencies. Token refresh
    happens HERE (at the composition root), not in the service.

    Args:
        config: Application configuration. If None, loads from environment.

    Returns:
        PostgresWriteService: Fully configured service with fresh tokens.

    Raises:
        StravaTokenError: If token refresh fails.
        ConfigurationError: If required configuration is missing.
    """
    if config is None:
        config = load_postgres_writer_config()

    # Token refresh happens HERE at the factory level
    # Service receives ready-to-use dependencies
    token_repo = make_read_strava_token(config.tokens)
    fresh_tokens = token_repo.refresh()

    # Create Strava reader with fresh tokens (returns StandardActivity)
    strava_reader = make_read_standard_activities(fresh_tokens)

    # Create UoW with session factory
    session_factory = create_session_factory(config.postgres_connection_string)
    uow = SqlAlchemyUnitOfWork(session_factory)

    return PostgresWriteService(
        uow=uow,
        strava_reader=strava_reader,
    )


__all__ = [
    "PostgresWriteService",
    "make_postgres_write_service",
]
