"""PostgreSQL sync services for webhook processing.

This module provides factory functions that wire together all dependencies
for the PostgreSQL writer service. Token refresh happens at the factory level,
not in the service - keeping the service focused on its core responsibility.

For optimal performance, the session factory should be created once at startup
and reused across requests via `make_session_factory()` and passed to
`make_postgres_write_service()`. This avoids creating a new connection pool
per request.
"""

from sqlalchemy.orm import Session, sessionmaker

from stravapipe.adapters.postgres import SqlAlchemyUnitOfWork
from stravapipe.adapters.postgres._unit_of_work import create_session_factory
from stravapipe.adapters.strava import (
    make_read_standard_activities,
    make_read_strava_token,
)
from stravapipe.application.postgres_sync.write_service import PostgresWriteService
from stravapipe.config import PostgresWriterConfig, load_postgres_writer_config


def make_session_factory(
    config: PostgresWriterConfig | None = None,
) -> sessionmaker[Session]:
    """Create a session factory for PostgreSQL connections.

    Call this once at startup to create a shared session factory, then pass
    it to `make_postgres_write_service()` for each request. This avoids
    creating a new connection pool per request.

    Args:
        config: Application configuration. If None, loads from environment.

    Returns:
        SQLAlchemy sessionmaker bound to the configured database.
    """
    if config is None:
        config = load_postgres_writer_config()
    return create_session_factory(config.postgres_connection_string)


def make_postgres_write_service(
    config: PostgresWriterConfig | None = None,
    session_factory: sessionmaker[Session] | None = None,
) -> PostgresWriteService:
    """Create a configured PostgresWriteService instance.

    Factory function that wires together all dependencies. Token refresh
    happens HERE (at the composition root), not in the service.

    For optimal performance, pass a pre-created session_factory (from
    `make_session_factory()`) to avoid creating a new connection pool
    per request.

    Args:
        config: Application configuration. If None, loads from environment.
        session_factory: Pre-created session factory. If None, creates a new
            one (not recommended for per-request usage).

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

    # Use provided session factory or create new one (latter not recommended)
    if session_factory is None:
        session_factory = create_session_factory(config.postgres_connection_string)
    uow = SqlAlchemyUnitOfWork(session_factory)

    return PostgresWriteService(
        uow=uow,
        strava_reader=strava_reader,
    )


__all__ = [
    "PostgresWriteService",
    "make_postgres_write_service",
    "make_session_factory",
]
